import assert from "node:assert/strict";
import { PassThrough, Writable } from "node:stream";
import { stripVTControlCharacters } from "node:util";
import test from "node:test";
import { listComponents } from "../src/catalog.mjs";
import { Picker, Prompts, PromptCancelled, parseSelection, pickComponents, pickerFrame } from "../src/prompts.mjs";

const components = listComponents();
const blocks = components.filter(({ kind }) => kind === "block");

test("text selection accepts IDs and bounded ranges without duplicate choices", () => {
  assert.deepEqual(parseSelection("1, 2-3 block/tdd", blocks), blocks.slice(0, 3).map(({ id }) => id));
  assert.deepEqual(parseSelection("", blocks), []);
  assert.deepEqual(parseSelection("none", blocks), []);
  assert.equal(parseSelection("all", blocks).length, blocks.length);
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
  assert.equal(picker.visible.length, 2);
  picker.handle("", { name: "return" });
  picker.handle("a");
  assert.deepEqual(picker.selection.map(({ id }) => id), ["block/tdd", "command/verify-work", "command/commit-work"]);
  picker.handle("a");
  assert.deepEqual(picker.selection.map(({ id }) => id), ["block/tdd"]);
  picker.handle("", { name: "escape" });
  assert.equal(picker.visible.length, components.length);
  picker.handle("", { name: "down" });
  picker.handle(" ");
  assert.deepEqual(picker.selection.map(({ id }) => id), ["block/tdd", "block/ponytail"]);
  assert.equal(picker.handle("", { name: "return" }), "submit");
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
    assert.match(frame.join("\n"), /Focused changes/);
    assert.match(frame.join("\n"), /8 selected · 411w always · ~712t/);
  }
  assert.match(pickerFrame(picker, { columns: 32, rows: 10 }).join("\n"), /Resize/);
});

test("categories, selection view, and full guides preserve choices and installed items", () => {
  const picker = new Picker(components, { installedIds: new Set(["skill/audit-code"]) });
  picker.handle("2");
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
  assert.equal(picker.tab, "block");
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
  picker.handle("2");
  picker.handle("a");
  assert.equal(picker.selection.filter(({ kind }) => kind === "skill").length,
    components.filter(({ kind }) => kind === "skill").length - 1);
  assert.ok(!picker.selected.has("skill/audit-code"));
  picker.handle("", { name: "tab", shift: true });
  assert.equal(picker.tab, "all");
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
      for (const heading of ["WHAT IT DOES", "USE WHEN", "EXAMPLE", "CONSIDER", "LOADING", "INSTALLS TO", "SOURCE"]) {
        assert.ok(transcript.includes(heading), `${component.id}: missing ${heading} at ${columns}x${rows}`);
      }
      assert.equal(picker.selection.length, 0, "reading never selects a component");
    }
  }
});

test("colored dashboards retain borders and fit terminal dimensions", (context) => {
  const oldForce = process.env.FORCE_COLOR;
  const oldNoColor = process.env.NO_COLOR;
  process.env.FORCE_COLOR = "1";
  delete process.env.NO_COLOR;
  context.after(() => {
    if (oldForce === undefined) delete process.env.FORCE_COLOR; else process.env.FORCE_COLOR = oldForce;
    if (oldNoColor === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = oldNoColor;
  });
  const picker = new Picker(components);
  picker.handle("2");
  const frame = pickerFrame(picker, { columns: 80, rows: 24 });
  assert.match(frame.join("\n"), /\x1b\[1;30;46m/);
  const plain = frame.map(stripVTControlCharacters);
  assert.ok(plain.every((line) => line.length <= 78));
  assert.match(plain.join("\n"), /WHAT IT DOES[\s\S]*USE WHEN/);
  assert.ok(plain.filter((line) => line.startsWith("│")).every((line) => line.endsWith("│")));
});

test("piped prompts buffer early answers and cancel explicitly at EOF", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const prompts = new Prompts({ input, output });
  input.end("1\nn\ny\n");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(await prompts.question("Pick: "), "1");
  assert.equal(await prompts.question("Connect: "), "n");
  assert.equal(await prompts.question("Install: "), "y");
  await assert.rejects(prompts.question("Again: "), PromptCancelled);
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
    if (finish === "submit") assert.deepEqual(selected, ["block/tdd"]);
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
