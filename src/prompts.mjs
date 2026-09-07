import readline from "node:readline";
import { Picker, pickerFrame } from "./dashboard.mjs";
export { Picker, pickerFrame } from "./dashboard.mjs";

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
      if (this.answers.length) return Promise.resolve(this.answers.shift());
      if (this.ended) return Promise.reject(new PromptCancelled());
      return new Promise((resolve, reject) => { this.pending = { resolve, reject }; });
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
    const range = /^(\d+)(?:-(\d+))?$/.exec(token);
    const start = Number(range?.[1]);
    const end = Number(range?.[2] ?? range?.[1]);
    if (!range || start < 1 || end > components.length || start > end) {
      throw new Error(`Invalid selection: ${token}. Use 1-${components.length}, component IDs, or none.`);
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
  const wasRaw = Boolean(input.isRaw);
  const wasPaused = input.isPaused();
  return new Promise((resolve, reject) => {
    let finished = false;
    const render = () => {
      try {
        const frame = pickerFrame(picker, { ...options, columns: output.columns, rows: output.rows });
        output.write(`\x1b[H${frame.map((line) => `${line}\x1b[K`).join("\n")}\x1b[J`);
      } catch (error) {
        finish(error);
      }
    };
    const cleanup = () => {
      input.off("keypress", onKey);
      input.off("end", onEnd);
      output.off("resize", render);
      input.setRawMode(wasRaw);
      if (wasPaused) input.pause();
      output.write("\x1b[?25h\x1b[?1049l");
    };
    const finish = (error) => {
      if (finished) return;
      finished = true;
      try { cleanup(); } catch (cleanupError) { error ??= cleanupError; }
      if (error) reject(error);
      else resolve(picker.selection.map(({ id }) => id));
    };
    const onKey = (text, key) => {
      const action = picker.handle(text, key);
      if (action) finish(action === "cancel" ? new PromptCancelled() : null);
      else render();
    };
    const onEnd = () => finish(new PromptCancelled());
    try {
      readline.emitKeypressEvents(input);
      input.setRawMode(true);
      input.on("keypress", onKey);
      input.once("end", onEnd);
      output.on("resize", render);
      input.resume();
      output.write("\x1b[?1049h\x1b[?25l");
      render();
    } catch (error) {
      finish(error);
    }
  });
}
