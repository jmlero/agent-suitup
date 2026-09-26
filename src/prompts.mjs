import readline from "node:readline";
import { AgentPicker, Picker, agentFrame, pickerFrame } from "./dashboard.mjs";
export { AgentPicker, Picker, agentFrame, pickerFrame } from "./dashboard.mjs";
import { sectionAlias } from "./ui.mjs";

const terminationSignals = process.platform === "win32" ? [] : ["SIGTERM", "SIGHUP"];

export class PromptCancelled extends Error {
  constructor() {
    super("Setup cancelled. No files written.");
  }
}

// Keep piped answers queued, including lines received while a plan is resolving.
export class Prompts {
  constructor({ input = process.stdin, output = process.stdout, plain = false } = {}) {
    this.input = input;
    this.output = output;
    this.keyboard = Boolean(input.isTTY && output.isTTY && !plain && process.env.TERM !== "dumb");
    this.answers = [];
    if (!input.isTTY) {
      this.reader = readline.createInterface({ input, terminal: false, crlfDelay: Infinity });
      this.reader.on("line", (answer) => {
        if (this.pending) {
          const { resolve } = this.pending;
          this.pending = null;
          resolve(answer);
        } else this.answers.push(answer);
      });
      this.reader.on("close", () => {
        this.ended = true;
        this.pending?.reject(new PromptCancelled());
        this.pending = null;
      });
    }
  }

  question(label) {
    if (this.reader) {
      this.output.write(label);
      // Piped answers are not echoed, so end the prompt line once one arrives.
      const answered = (answer) => { this.output.write("\n"); return answer; };
      if (this.answers.length) return Promise.resolve(answered(this.answers.shift()));
      if (this.ended) return Promise.reject(new PromptCancelled());
      return new Promise((resolve, reject) => { this.pending = { resolve, reject }; }).then(answered);
    }
    if (this.input.readableEnded) return Promise.reject(new PromptCancelled());
    return new Promise((resolve, reject) => {
      const reader = readline.createInterface({ input: this.input, output: this.output, terminal: this.keyboard });
      let answered = false;
      const interrupt = () => reader.close();
      if (!this.keyboard) process.once("SIGINT", interrupt);
      reader.on("SIGINT", interrupt);
      reader.on("close", () => {
        process.off("SIGINT", interrupt);
        if (!answered) reject(new PromptCancelled());
      });
      reader.question(label, (answer) => {
        answered = true;
        reader.close();
        resolve(answer);
      });
    });
  }

  canPick() {
    return this.keyboard && (this.output.columns ?? 80) >= 40 && (this.output.rows ?? 24) >= 16;
  }

  pick(components, options) {
    return pickComponents(components, { ...options, input: this.input, output: this.output });
  }

  pickAgents(options) {
    return pickAgents({ ...options, input: this.input, output: this.output });
  }

  close() {
    this.reader?.close();
    this.input.pause();
  }
}

export function parseSelection(answer, components) {
  const value = answer.trim().toLowerCase();
  if (!value || value === "none") return [];
  if (value === "all") return components.map(({ id }) => id);
  const selected = new Set();
  for (const token of value.split(/[\s,]+/).filter(Boolean)) {
    const component = components.find(({ id }) => id === token);
    if (component) { selected.add(component.id); continue; }
    // A group name such as blocks or skills selects the whole group.
    const kind = sectionAlias(token);
    if (kind && components.some((item) => item.kind === kind)) {
      for (const item of components) if (item.kind === kind) selected.add(item.id);
      continue;
    }
    const range = /^(\d+)(?:-(\d+))?$/.exec(token);
    const start = Number(range?.[1]);
    const end = Number(range?.[2] ?? range?.[1]);
    if (!range || start < 1 || end > components.length || start > end) {
      throw new Error(`Invalid selection: ${token}. Use 1-${components.length}, component IDs, a group such as blocks, or none.`);
    }
    for (let index = start; index <= end; index += 1) selected.add(components[index - 1].id);
  }
  if (!selected.size) throw new Error("Choose a number, component ID, or none.");
  return [...selected];
}

export function pickComponents(components, {
  input = process.stdin, output = process.stdout, ...options
} = {}) {
  const picker = new Picker(components, options);
  return runScreen(picker, (size) => pickerFrame(picker, { ...options, ...size }),
    (action) => ({ ids: picker.selection.map(({ id }) => id), scope: picker.scope, ...(action === "back" && { back: true }) }),
    { input, output });
}

export function pickAgents({ input = process.stdin, output = process.stdout, ...options } = {}) {
  const model = new AgentPicker(options);
  return runScreen(model, (size) => agentFrame(model, size), () => model.selection, { input, output });
}

// Runs one full-screen keyboard view until its model submits or cancels.
function runScreen(model, frame, result, { input, output }) {
  const wasRaw = Boolean(input.isRaw);
  // A stream nobody has read yet is not flowing either; leave it paused so
  // input typed during the picker waits for the next prompt.
  const wasFlowing = input.readableFlowing === true;
  return new Promise((resolve, reject) => {
    let finished = false;
    const render = () => {
      try {
        const lines = frame({ columns: output.columns, rows: output.rows });
        output.write(`\x1b[H${lines.map((line) => `${line}\x1b[K`).join("\n")}\x1b[J`);
      } catch (error) {
        finish(error);
      }
    };
    // Restore the screen first: raw mode can fail once the terminal is gone.
    const cleanup = () => {
      input.off("keypress", onKey);
      input.off("end", onEnd);
      output.off("resize", render);
      for (const signal of terminationSignals) process.off(signal, onSignal);
      output.write("\x1b[?2004l\x1b[?25h\x1b[?1049l");
      if (!wasFlowing) input.pause();
      input.setRawMode(wasRaw);
    };
    const finish = (error, action) => {
      if (finished) return;
      finished = true;
      try { cleanup(); } catch (cleanupError) { error ??= cleanupError; }
      if (error) reject(error);
      else resolve(result(action));
    };
    const onKey = (text, key) => {
      const action = model.handle(text, key);
      if (action) finish(action === "cancel" ? new PromptCancelled() : null, action);
      else render();
    };
    const onEnd = () => finish(new PromptCancelled());
    // Restore the terminal, then let the signal terminate the process as usual.
    const onSignal = (signal) => {
      finish(new PromptCancelled());
      process.kill(process.pid, signal);
    };
    try {
      readline.emitKeypressEvents(input);
      input.setRawMode(true);
      input.on("keypress", onKey);
      input.once("end", onEnd);
      output.on("resize", render);
      for (const signal of terminationSignals) process.once(signal, onSignal);
      input.resume();
      output.write("\x1b[?1049h\x1b[?25l\x1b[?2004h");
      render();
    } catch (error) {
      finish(error);
    }
  });
}
