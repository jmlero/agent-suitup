import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import test from "node:test";
import { listComponents } from "../src/catalog.mjs";
import { componentKinds } from "../src/component-guide.mjs";
import { displayWidth } from "../src/dashboard.mjs";
import {
  AgentPicker, Picker, Prompts, PromptCancelled, agentFrame, parseSelection, pickAgents, pickComponents, pickerFrame,
} from "../src/prompts.mjs";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const components = listComponents();
const blocks = components.filter(({ kind }) => kind === "block");

test("text selection accepts IDs and bounded ranges without duplicate choices", () => {
  assert.deepEqual(parseSelection("1, 2-3 block/tdd", blocks), blocks.slice(0, 3).map(({ id }) => id));
  assert.deepEqual(parseSelection("", blocks), []);
  assert.deepEqual(parseSelection("none", blocks), []);
  assert.equal(parseSelection("all", blocks).length, blocks.length);
  assert.deepEqual(parseSelection("Blocks", components), blocks.map(({ id }) => id), "a group name selects the whole group");
  assert.deepEqual(parseSelection("skill-commands, 1", components), ["command/commit-work", "block/tdd"]);
  assert.throws(() => parseSelection("skills", blocks), /a group such as blocks/, "a group with no items is not a valid choice");
  for (const answer of ["0", String(blocks.length + 1), "3-1", "1-99999999999999999999", "1.5", ",", "wat", "1-2-3"]) {
    assert.throws(() => parseSelection(answer, blocks), /selection|Choose/i);
  }
});

test("keyboard search preserves picks and toggles only visible results", () => {
  const picker = new Picker(components);
  assert.deepEqual(picker.selection, []);
  picker.handle(" ", { name: "space" });
  picker.handle("/");
  picker.handle("command/");
  assert.equal(picker.visible.length, 1);
  picker.handle("", { name: "return" });
  picker.handle("a");
  assert.deepEqual(picker.selection.map(({ id }) => id), ["block/tdd", "command/commit-work"]);
  picker.handle("a");
  assert.deepEqual(picker.selection.map(({ id }) => id), ["block/tdd"]);
  picker.handle("", { name: "escape" });
  assert.equal(picker.visible.length, components.length);
  picker.handle("", { name: "down" });
  picker.handle(" ");
  assert.deepEqual(picker.selection.map(({ id }) => id), ["block/tdd", "block/ponytail"]);
  assert.equal(picker.handle("", { name: "return" }), "submit");
});

test("group headings are rows that select or clear their whole group", () => {
  const picker = new Picker(components, { installedIds: new Set(["skill/audit-docs"]) });
  const frame = (size = { columns: 120, rows: 40 }) => pickerFrame(picker, size).map(stripVTControlCharacters).join("\n");
  const kinds = (kind) => picker.selection.filter((component) => component.kind === kind).map(({ id }) => id);
  const blockIds = blocks.map(({ id }) => id);
  const skillIds = components.filter(({ kind, id }) => kind === "skill" && id !== "skill/audit-docs").map(({ id }) => id);
  assert.equal(picker.focused.id, "block/tdd", "the list starts on the first item, not its heading");
  assert.match(frame(), /\n {2}○ Blocks {2}always-on rules[^\n]*\n❯ {3}○ Test-driven development/);
  picker.handle("", { name: "up" });
  assert.equal(picker.focusedGroup, "block");
  assert.equal(picker.focused, undefined);
  assert.match(frame(), /❯ ○ Blocks {2}always-on rules/);
  assert.match(frame(), /9 blocks · 0 selected[\s\S]*Space selects all 9[\s\S]*All of them add 587 words \(~946 tokens\) to every session/);
  picker.handle("", { name: "up" });
  assert.equal(picker.focusedGroup, "block", "the first heading is the top of the list");
  picker.handle(" ", { name: "space" });
  assert.deepEqual(kinds("block"), blockIds);
  assert.match(frame(), /❯ ● Blocks/);
  assert.match(frame(), /9 selected · \+587 words always on/);
  picker.handle("", { name: "down" });
  picker.handle(" ", { name: "space" });
  assert.equal(kinds("block").length, blockIds.length - 1);
  assert.match(frame(), /◐ Blocks/, "a partial group shows a half mark");
  picker.handle("", { name: "up" });
  picker.handle(" ", { name: "space" });
  assert.deepEqual(kinds("block"), blockIds, "a partial group selects the rest");
  picker.handle(" ", { name: "space" });
  assert.deepEqual(kinds("block"), [], "a full group clears");

  for (let step = 0; step < blocks.length + 1; step += 1) picker.handle("", { name: "down" });
  assert.equal(picker.focusedGroup, "skill", "moving down from the last item of a group lands on the next heading");
  picker.handle(" ", { name: "space" });
  assert.deepEqual(kinds("skill"), skillIds, "installed items are never selected");
  assert.match(frame(), /5 skills · 4 selected · 1 installed[\s\S]*Space clears all 4/);
  picker.handle("", { name: "up" });
  assert.equal(picker.focused.id, blocks.at(-1).id, "moving up from a heading lands on the previous group's last item");

  picker.handle("s");
  picker.handle("", { name: "home" });
  assert.equal(picker.focusedGroup, "skill", "Home goes to the first heading");
  picker.handle(" ", { name: "space" });
  assert.deepEqual(picker.selection, [], "clearing a group in the selection view empties it");
  assert.equal(picker.focusedGroup, undefined);
  assert.match(frame(), /Nothing selected yet/);
  picker.handle("", { name: "escape" });

  picker.handle("/");
  picker.handle("test");
  picker.handle("", { name: "return" });
  picker.handle("", { name: "home" });
  const matching = picker.visible.filter(({ kind }) => kind === picker.focusedGroup);
  assert.ok(matching.length && matching.length < components.filter(({ kind }) => kind === picker.focusedGroup).length);
  picker.handle(" ", { name: "space" });
  assert.deepEqual(picker.selection.map(({ id }) => id), matching.map(({ id }) => id), "a filtered group selects only its matches");

  for (const [columns, rows] of [[40, 16], [60, 20], [80, 24]]) {
    const lines = pickerFrame(picker, { columns, rows }).map(stripVTControlCharacters);
    assert.ok(lines.length < rows && lines.every((line) => displayWidth(line) <= columns - 2), `${columns}x${rows}`);
    assert.match(lines.join("\n"), new RegExp(`❯ [●◐○] ${componentKinds[picker.focusedGroup].plural}`), `${columns}x${rows} shows the focused heading`);
  }
});

test("empty searches and cancellation cannot accidentally select an item", () => {
  const picker = new Picker(components);
  picker.handle("/");
  picker.handle("no-matching-component");
  picker.handle("", { name: "return" });
  picker.handle("", { name: "down" });
  picker.handle(" ");
  picker.handle("a");
  assert.deepEqual(picker.selection, []);
  assert.match(pickerFrame(picker).join("\n"), /No matches/);
  picker.handle("", { name: "escape" });
  assert.equal(picker.handle("", { name: "escape" }), "cancel");
  assert.equal(picker.handle("", { name: "c", ctrl: true }), "cancel");
});

test("picker fits small terminals, scrolls to focus, and shows aggregate block cost", () => {
  const picker = new Picker(blocks);
  picker.handle("a");
  picker.handle("", { name: "end" });
  for (const [columns, rows] of [[40, 16], [60, 20], [80, 24], [120, 40]]) {
    const frame = pickerFrame(picker, { columns, rows }).map(stripVTControlCharacters);
    assert.ok(frame.length < rows, `${frame.length} lines for ${rows} rows`);
    assert.ok(frame.every((line) => Array.from(line).length <= columns - 2));
    assert.match(frame.join("\n"), /Durable task list/);
    assert.match(frame.join("\n"), /9 selected · \+587 words always on/);
    if (columns >= 62) assert.match(frame.join("\n"), /\(~946 tokens\)/);
  }
  assert.match(pickerFrame(picker, { columns: 32, rows: 10 }).join("\n"), /Resize/);
});

test("categories, selection view, and full guides preserve choices and installed items", () => {
  const picker = new Picker(components, { installedIds: new Set(["skill/audit-docs"]) });
  assert.deepEqual(picker.tabs.map(({ label }) => label), ["All", "Blocks", "Skills", "Skill commands", "Integrations"]);
  picker.handle("3");
  assert.ok(picker.visible.every(({ kind }) => kind === "skill"));
  picker.handle(" ");
  assert.equal(picker.selection.length, 0, "installed items cannot be selected or removed");
  picker.handle("", { name: "down" });
  picker.handle("i");
  pickerFrame(picker);
  picker.handle("", { name: "end" });
  assert.ok(picker.detailOffset > 0);
  picker.handle(" ");
  assert.equal(picker.handle("", { name: "return" }), undefined, "Enter closes the guide, never submits");
  assert.equal(picker.inspected, null);
  picker.handle("", { name: "tab" });
  assert.equal(picker.tab, "command");
  picker.handle(" ");
  picker.handle("s");
  assert.equal(picker.visible.length, 2);
  picker.handle("i");
  picker.handle(" ");
  assert.equal(picker.visible.length, 1);
  assert.ok(picker.inspected, "removing a selection does not replace the guide being read");
  picker.handle("", { name: "escape" });
  picker.handle("s");
  assert.equal(picker.tab, "all");
  picker.handle("3");
  picker.handle("a");
  assert.equal(picker.selection.filter(({ kind }) => kind === "skill").length,
    components.filter(({ kind }) => kind === "skill").length - 1);
  assert.ok(!picker.selected.has("skill/audit-docs"));
  picker.handle("", { name: "tab", shift: true });
  assert.equal(picker.tab, "block");
});

test("all component guides can be read completely at every supported terminal size", () => {
  for (const [columns, rows] of [[40, 16], [60, 20], [80, 24], [120, 40]]) {
    for (const component of components) {
      const picker = new Picker([component]);
      picker.handle("i");
      let transcript = "";
      do {
        const frame = pickerFrame(picker, { columns, rows }).map(stripVTControlCharacters);
        assert.ok(frame.length < rows, `${component.id}: ${frame.length} lines in ${rows} rows`);
        assert.ok(frame.every((line) => Array.from(line).length <= columns - 2), component.id);
        transcript += frame.join("\n");
        if (picker.detailOffset === picker.detailMaximum) break;
        picker.handle("", { name: "down" });
      } while (true);
      const headings = ["Use when", "Consider", "Source", "Files", component.kind === "block" ? "Adds to .agents/rules.md" : component.kind === "plugin" ? "Adds to .claude/settings.json" : "SKILL.md"];
      for (const heading of headings) {
        assert.ok(transcript.includes(heading), `${component.id}: missing ${heading} at ${columns}x${rows}`);
      }
      assert.equal(picker.selection.length, 0, "reading never selects a component");
    }
  }
});

test("colored dashboards fit terminal dimensions and keep the column divider", (context) => {
  const oldForce = process.env.FORCE_COLOR;
  const oldNoColor = process.env.NO_COLOR;
  process.env.FORCE_COLOR = "1";
  delete process.env.NO_COLOR;
  context.after(() => {
    if (oldForce === undefined) delete process.env.FORCE_COLOR; else process.env.FORCE_COLOR = oldForce;
    if (oldNoColor === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = oldNoColor;
  });
  const picker = new Picker(components);
  picker.handle("3");
  const frame = pickerFrame(picker, { columns: 80, rows: 24, adapters: ["claude"] });
  assert.match(frame[1], /\x1b\[1;7m Skills 5 \x1b\[0m/, "the active category is highlighted");
  const plain = frame.map(stripVTControlCharacters);
  assert.ok(plain.every((line) => displayWidth(line) <= 78));
  assert.match(plain[0], /^agent-suitup · Claude Code\s+✓ Agents › Choose › Review$/);
  assert.match(plain.join("\n"), /Skills  loaded when relevant[\s\S]*Use when[\s\S]*Example/);
  const body = plain.slice(3, plain.lastIndexOf(plain[2]));
  assert.ok(body.every((line) => line.indexOf(" │ ") === 32), "list and details share one divider column");
});

test("piped prompts buffer early answers and cancel explicitly at EOF", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  output.setEncoding("utf8");
  const prompts = new Prompts({ input, output });
  input.write("1\nn\n");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(await prompts.question("Pick: "), "1");
  assert.equal(await prompts.question("Connect: "), "n");
  const pending = prompts.question("Install: ");
  input.end("y\n");
  assert.equal(await pending, "y");
  await assert.rejects(prompts.question("Again: "), PromptCancelled);
  assert.equal(output.read(), "Pick: \nConnect: \nInstall: \nAgain: ", "each answered prompt ends its line");
  assert.equal(prompts.canPick(), false);
  prompts.close();
});

test("raw picker restores terminal mode, cursor and listeners on submit, cancel and EOF", async () => {
  for (const finish of ["submit", "cancel", "eof"]) {
    const input = new PassThrough();
    input.isTTY = true;
    input.isRaw = false;
    input.setRawMode = (value) => { input.isRaw = value; };
    input.pause();
    let transcript = "";
    const output = new Writable({ write(chunk, encoding, callback) { transcript += chunk; callback(); } });
    output.columns = 80;
    output.rows = 24;
    const result = pickComponents(blocks, { input, output });
    const checked = finish === "submit" ? result : assert.rejects(result, PromptCancelled);
    assert.equal(input.isRaw, true);
    input.write(" ");
    output.columns = 50;
    output.emit("resize");
    if (finish === "submit") input.write("\r");
    else if (finish === "cancel") input.write("\x03");
    else input.end();
    const selected = await checked;
    if (finish === "submit") assert.deepEqual(selected, { ids: ["block/tdd"], scope: "project" });
    assert.equal(input.isRaw, false);
    assert.equal(input.isPaused(), true);
    assert.equal(input.listenerCount("keypress"), 0);
    assert.equal(output.listenerCount("resize"), 0);
    assert.ok(transcript.startsWith("\x1b[?1049h\x1b[?25l"));
    assert.ok(transcript.endsWith("\x1b[?25h\x1b[?1049l"));
    assert.ok(transcript.includes("\x1b[K\n"), "redraw clears stale text at the end of each line");
  }
});

test("a rendering failure restores terminal state before rejecting", async () => {
  const input = new PassThrough();
  input.isRaw = false;
  input.setRawMode = (value) => { input.isRaw = value; };
  input.pause();
  const output = new PassThrough();
  await assert.rejects(pickComponents(blocks, {
    input, output,
    suggest() { throw new Error("Rendering failed"); },
  }), /Rendering failed/);
  assert.equal(input.isRaw, false);
  assert.equal(input.isPaused(), true);
  assert.equal(input.listenerCount("keypress"), 0);
  assert.equal(output.listenerCount("resize"), 0);
});

test("plain mode and small terminals do not enter the keyboard picker", () => {
  const input = new PassThrough();
  const output = new PassThrough();
  input.isTTY = output.isTTY = true;
  output.columns = 80;
  output.rows = 24;
  const plain = new Prompts({ input, output, plain: true });
  assert.equal(plain.canPick(), false);
  const small = new Prompts({ input, output });
  output.columns = 30;
  assert.equal(small.canPick(), false);
  output.columns = 80;
  output.rows = 10;
  assert.equal(small.canPick(), false);
  plain.close();
  small.close();
});

test("the picker leaves a fresh input stream paused with typed-ahead input intact", async () => {
  const { input, output } = fakeTerminal();
  assert.equal(input.readableFlowing, null);
  const result = pickComponents(blocks, { input, output });
  input.write("\r");
  assert.deepEqual(await result, { ids: [], scope: "project" });
  assert.equal(input.isPaused(), true);
  input.write("y\n");
  assert.equal(input.read().toString(), "y\n");
});

test("terminal restoration writes the screen reset even when raw mode cannot be restored", async () => {
  const { input, output, transcript } = fakeTerminal();
  const result = pickComponents(blocks, { input, output });
  input.setRawMode = () => { throw new Error("EIO: terminal closed"); };
  input.write("\r");
  await assert.rejects(result, /EIO/);
  assert.ok(transcript().endsWith("\x1b[?2004l\x1b[?25h\x1b[?1049l"));
  assert.equal(input.listenerCount("keypress"), 0);
  for (const signal of ["SIGTERM", "SIGHUP"]) assert.equal(process.listenerCount(signal), 0, signal);
});

for (const signal of ["SIGTERM", "SIGHUP"]) {
  test(`${signal} restores the terminal before the process exits`, { skip: process.platform === "win32" }, () => {
    const script = `
      import { PassThrough, Writable } from "node:stream";
      import { listComponents } from "./src/catalog.mjs";
      import { pickComponents } from "./src/prompts.mjs";
      const input = new PassThrough();
      input.isTTY = true;
      input.isRaw = false;
      input.setRawMode = (value) => { input.isRaw = value; };
      const output = new Writable({ write(chunk, encoding, callback) { process.stdout.write(chunk, callback); } });
      output.columns = 80;
      output.rows = 24;
      pickComponents(listComponents(), { input, output }).catch(() => {});
      setTimeout(() => process.kill(process.pid, "${signal}"), 20);
      setTimeout(() => process.exit(3), 2000);
    `;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      cwd: repository, encoding: "utf8", timeout: 5_000,
    });
    assert.equal(result.signal, signal, result.stderr);
    assert.match(result.stdout, /^\x1b\[\?1049h/);
    assert.ok(result.stdout.endsWith("\x1b[?2004l\x1b[?25h\x1b[?1049l"), JSON.stringify(result.stdout.slice(-40)));
  });
}

test("category tabs wrap before they would be truncated", () => {
  const picker = new Picker(components);
  for (const columns of [55, 75, 80]) {
    const frame = pickerFrame(picker, { columns, rows: 24 }).map(stripVTControlCharacters);
    const tabRows = frame.slice(1, frame.findIndex((line) => line.startsWith("─")));
    assert.ok(tabRows.length, `${columns}: no tab row`);
    assert.ok(tabRows.every((line) => !line.includes("…") && displayWidth(line) <= columns - 2), `${columns}: ${tabRows}`);
    assert.match(tabRows.join(" "), /All 19.*Blocks 9.*Skills 5.*Skill commands 1.*Integrations 4/);
  }
});

test("Tab and Shift+Tab from the selection view move next to the category it came from", () => {
  const picker = new Picker(components);
  picker.handle("3");
  picker.handle("s");
  assert.equal(picker.tab, "selected");
  picker.handle("", { name: "tab" });
  assert.equal(picker.tab, "command");
  picker.handle("s");
  picker.handle("", { name: "tab", shift: true });
  assert.equal(picker.tab, "skill");
  picker.handle("s");
  picker.handle("", { name: "left" });
  assert.equal(picker.tab, "block");
});

test("wide characters and emoji fit the frame and delete as whole graphemes", () => {
  const wide = components.map((component, index) => index < 2
    ? { ...component, name: `漢字スキル ${"👨‍👩‍👧".repeat(3)} ${component.name}`, description: `全角の説明文です。${component.description}` }
    : component);
  const picker = new Picker(wide);
  for (const [columns, rows] of [[40, 16], [60, 20], [80, 24], [120, 40]]) {
    const frame = pickerFrame(picker, { columns, rows }).map(stripVTControlCharacters);
    assert.ok(frame.every((line) => displayWidth(line) <= columns - 2), `${columns}x${rows}`);
    assert.ok(frame.length < rows, `${columns}x${rows}`);
  }
  picker.handle("/");
  for (const text of ["e\u0301", "👍🏽", "漢"]) picker.handle(text);
  picker.handle("", { name: "backspace" });
  assert.equal(picker.query, "e\u0301👍🏽");
  picker.handle("", { name: "backspace" });
  assert.equal(picker.query, "e\u0301");
});

test("pasted text filters the catalog without triggering shortcuts or submitting", async () => {
  const picker = new Picker(components);
  picker.handle("i");
  assert.ok(picker.inspected);
  picker.handle(undefined, { name: "paste-start" });
  for (const character of "audit\r\ndocs") {
    const name = character === "\r" ? "return" : character === "\n" ? "enter" : character;
    assert.equal(picker.handle(character, { name }), undefined);
  }
  picker.handle(undefined, { name: "paste-end" });
  assert.equal(picker.inspected, null);
  assert.equal(picker.query, "audit docs");
  assert.deepEqual(picker.visible.map(({ id }) => id), ["skill/audit-docs"]);
  assert.deepEqual(picker.selection, [], "pasted letters never select items");

  const { input, output, transcript } = fakeTerminal();
  const result = pickComponents(blocks, { input, output });
  input.write("\x1b[200~a\r\x1b[201~");
  input.write("\x03");
  await assert.rejects(result, PromptCancelled);
  assert.ok(transcript().includes("\x1b[?2004h"), "bracketed paste is enabled");
});

test("u switches new items between this project and all projects, and the details follow", async () => {
  const picker = new Picker(components);
  const frame = () => pickerFrame(picker, { columns: 120, rows: 40, adapters: ["claude", "codex"] })
    .map(stripVTControlCharacters).join("\n");
  assert.equal(picker.scope, "project");
  assert.match(frame(), /Install for this project {2}u change/);
  picker.handle("\t", { name: "tab" });
  picker.handle("\t", { name: "tab" });
  assert.equal(picker.focused.kind, "skill");
  const name = picker.focused.id.slice("skill/".length);
  assert.match(frame(), new RegExp(`\\n.*│   \\.agents/skills/${name}/`));
  picker.handle("u");
  assert.equal(picker.scope, "user");
  assert.match(frame(), /Install for all projects {2}u change/);
  assert.match(frame(), new RegExp(`│   ~/\\.agents/skills/${name}/\\s+Codex reads it here`));
  picker.handle(undefined, { name: "up" });
  assert.match(frame(), /Installs for all projects, in your home folder\. Press u to install in/);
  picker.handle("u");
  assert.equal(picker.scope, "project");

  const blocksOnly = new Picker(blocks, { scope: "user" });
  blocksOnly.handle("u");
  assert.equal(blocksOnly.scope, "user", "u does nothing when no item can install for all projects");
  assert.doesNotMatch(pickerFrame(blocksOnly, { columns: 120, rows: 40 }).map(stripVTControlCharacters).join("\n"), /Install for/);

  const { input, output } = fakeTerminal();
  const result = pickComponents(components, { input, output, scope: "user" });
  input.write("u");
  input.write("\r");
  assert.deepEqual(await result, { ids: [], scope: "project" }, "the picker starts from --scope and returns the final choice");
});

test("b leaves the picker to go back only when there is a previous step, keeping the selection", async () => {
  const offered = components.filter(({ kind }) => kind !== "plugin");
  const picker = new Picker(offered, { selected: ["block/tdd", "plugin/frontend-design"], back: true });
  assert.deepEqual(picker.selection.map(({ id }) => id), ["block/tdd"], "items no longer offered are dropped");
  assert.match(pickerFrame(picker, { columns: 120, rows: 30 }).map(stripVTControlCharacters).join("\n"), /b back/);
  picker.handle("/");
  assert.equal(picker.handle("b", { name: "b" }), undefined, "b types into the search");
  picker.handle(undefined, { name: "escape" });
  assert.equal(picker.handle("b", { name: "b" }), "back");

  const first = new Picker(offered);
  assert.equal(first.handle("b", { name: "b" }), undefined);
  assert.doesNotMatch(pickerFrame(first, { columns: 120, rows: 30 }).map(stripVTControlCharacters).join("\n"), /b back/);

  const { input, output } = fakeTerminal();
  const result = pickComponents(offered, { input, output, back: true, selected: ["skill/audit-docs"], scope: "user" });
  input.write("b");
  assert.deepEqual(await result, { ids: ["skill/audit-docs"], scope: "user", back: true });
});

test("a terminal too small for the picker ignores everything except cancel", () => {
  const picker = new Picker(blocks);
  pickerFrame(picker, { columns: 30, rows: 10 });
  assert.equal(picker.handle("", { name: "return" }), undefined);
  picker.handle(" ", { name: "space" });
  picker.handle("a");
  assert.deepEqual(picker.selection, []);
  assert.equal(picker.handle("", { name: "escape" }), "cancel");
  pickerFrame(picker, { columns: 80, rows: 24 });
  assert.equal(picker.handle("", { name: "return" }), "submit");
});

test("the picker shows the exact text a block adds and where each agent reads a skill", () => {
  const picker = new Picker(components);
  const frame = pickerFrame(picker, { columns: 120, rows: 40, adapters: ["claude", "codex"] }).map(stripVTControlCharacters).join("\n");
  assert.match(frame, /Adds to \.agents\/rules\.md\s*\n.*│ ## Test-driven development/);
  assert.match(frame, /\.agents\/rules\.md\s+this block, between agent-suitup markers/);
  assert.match(frame, /AGENTS\.md\s+one link line, shared by all blocks/);
  picker.handle("3");
  const skill = pickerFrame(picker, { columns: 120, rows: 40, adapters: ["claude", "codex"] }).map(stripVTControlCharacters).join("\n");
  assert.match(skill, /\.agents\/skills\/audit-docs\/\s+Codex reads it here/);
  assert.match(skill, /\.claude\/skills\/audit-docs\s+Claude Code reads it here \((link|copy)\)/);
  assert.match(skill, /SKILL\.md\s*\n.*│ ---\n.*│ name: audit-docs/);
  picker.handle("4");
  const command = pickerFrame(picker, { columns: 120, rows: 40, adapters: ["grok"] }).map(stripVTControlCharacters).join("\n");
  assert.match(command, /Skill commands  run with \/name/);
  assert.match(command, /Skill command · runs when you invoke it/);
  assert.match(command, /Run it\s+\/commit-work in Grok Build\. The agent never starts it/);
  assert.match(command, /\.agents\/skills\/commit-work\/\s+source files/, "Grok runs commands through its wrapper");
  assert.match(command, /\.grok\/skills\/commit-work\/SKILL\.md\s+Grok Build · \/commit-work only/);
});

test("the agent screen starts on All agents, keeps existing ones, and needs at least one", () => {
  const picker = new AgentPicker({ detected: new Set(["codex"]) });
  const frame = () => agentFrame(picker, { columns: 80, rows: 24 }).map(stripVTControlCharacters).join("\n");
  assert.match(frame(), /Which coding agents do you use\?/);
  assert.deepEqual(picker.selection, ["claude", "codex", "grok"], "all agents are selected by default");
  assert.match(frame(), /❯ ● All agents\s+recommended · every item works in every agent/);
  assert.match(frame(), /\n {4}● Claude Code\s+skills in \.claude\/skills \(linked\) · \/skill-name/);
  assert.match(frame(), /● Codex\s+skills in \.agents\/skills · \$skill-name\s+detected/);
  assert.match(frame(), /a all/);
  picker.handle(" ", { name: "space" });
  assert.deepEqual(picker.selection, [], "Space on All agents clears every agent");
  assert.match(frame(), /○ All agents/);
  assert.equal(picker.handle("", { name: "return" }), undefined, "Enter needs a choice");
  assert.match(frame(), /Choose at least one agent/);
  picker.handle("1");
  picker.handle("3");
  assert.deepEqual(picker.selection, ["claude", "grok"]);
  assert.match(frame(), /◐ All agents/, "a partial choice shows a half mark");
  assert.match(frame(), /❯ {3}● Grok Build/, "number keys move the cursor to the agent");
  picker.handle("", { name: "up" });
  picker.handle(" ", { name: "space" });
  assert.deepEqual(picker.selection, ["claude", "codex", "grok"], "Space toggles the agent under the cursor");
  assert.match(frame(), /● All agents/);
  picker.handle("a");
  assert.deepEqual(picker.selection, [], "a clears every agent when all are selected");
  picker.handle("a");
  assert.deepEqual(picker.selection, ["claude", "codex", "grok"], "a selects every agent");
  assert.equal(picker.cursor, 0);
  picker.handle("1");
  picker.handle("2");
  picker.handle("3");
  assert.deepEqual(picker.selection, []);
  picker.handle("1");
  picker.handle(undefined, { name: "paste-start" });
  picker.handle("2", { name: "2" });
  picker.handle(undefined, { name: "paste-end" });
  assert.deepEqual(picker.selection, ["claude"], "pasted text never toggles agents");
  assert.equal(picker.handle("", { name: "return" }), "submit");
  assert.equal(picker.handle("", { name: "escape" }), "cancel");

  const existing = new AgentPicker({ enabled: ["grok"], selected: [] });
  existing.handle("3");
  assert.deepEqual(existing.selection, ["grok"], "setup never drops an agent");
  existing.handle("a");
  assert.deepEqual(existing.selection, ["claude", "codex", "grok"]);
  existing.handle("a");
  assert.deepEqual(existing.selection, ["grok"], "clearing all keeps existing agents");
  assert.match(agentFrame(existing, { columns: 80, rows: 24 }).map(stripVTControlCharacters).join("\n"), /✓ Grok Build.*set up/);
  for (const [columns, rows] of [[40, 16], [60, 20], [120, 40]]) {
    const lines = agentFrame(picker, { columns, rows }).map(stripVTControlCharacters);
    assert.ok(lines.length < rows && lines.every((line) => displayWidth(line) <= columns - 2), `${columns}x${rows}`);
    assert.ok(lines.some((line) => line.includes("All agents")), `${columns}x${rows} keeps All agents`);
  }
});

test("the agent screen restores the terminal and returns the chosen agents", async () => {
  const { input, output, transcript } = fakeTerminal();
  const result = pickAgents({ input, output, enabled: ["codex"] });
  input.write("1");
  input.write("\r");
  assert.deepEqual(await result, ["codex", "grok"]);
  assert.equal(input.isRaw, false);
  assert.equal(input.listenerCount("keypress"), 0);
  assert.ok(transcript().endsWith("\x1b[?2004l\x1b[?25h\x1b[?1049l"));
});

function fakeTerminal() {
  const input = new PassThrough();
  input.isTTY = true;
  input.isRaw = false;
  input.setRawMode = (value) => { input.isRaw = value; };
  let written = "";
  const output = new Writable({ write(chunk, encoding, callback) { written += chunk; callback(); } });
  output.columns = 80;
  output.rows = 24;
  return { input, output, transcript: () => written };
}
