import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ConflictError, Planner, formatPlan } from "../src/planner.mjs";
import { statePaths } from "../src/state.mjs";

const scenarios = [
  {
    name: "content edited before overwrite",
    initial: (file) => fs.writeFileSync(file, "Original.\n"),
    plan: (planner, file) => planner.write(file, "Updated.\n", { owned: true }),
    change: (file) => fs.writeFileSync(file, "New local edit.\n"),
  },
  {
    name: "content edited before forced deletion",
    force: true,
    initial: (file) => fs.writeFileSync(file, "Original.\n"),
    plan: (planner, file) => planner.delete(file, { owned: true, expectedKind: "file" }),
    change: (file) => fs.writeFileSync(file, "New local edit.\n"),
  },
  {
    name: "new file occupying a planned creation",
    initial: () => {},
    plan: (planner, file) => planner.write(file, "agent-suitup content.\n"),
    change: (file) => fs.writeFileSync(file, "User-created file.\n"),
  },
  {
    name: "file removed before overwrite",
    initial: (file) => fs.writeFileSync(file, "Original.\n"),
    plan: (planner, file) => planner.write(file, "Updated.\n", { owned: true }),
    change: (file) => fs.unlinkSync(file),
  },
  {
    name: "permissions changed before overwrite",
    posix: true,
    initial: (file) => fs.writeFileSync(file, "Original.\n", { mode: 0o644 }),
    plan: (planner, file) => planner.write(file, "Updated.\n", { owned: true }),
    change: (file) => fs.chmodSync(file, 0o600),
  },
  {
    name: "symlink retargeted before replacement",
    posix: true,
    initial: (file) => fs.symlinkSync("original.md", file),
    plan: (planner, file) => planner.symlink(file, "updated.md", { owned: true }),
    change: (file) => {
      fs.unlinkSync(file);
      fs.symlinkSync("local.md", file);
    },
  },
  {
    name: "symlink replaced with a file before deletion",
    posix: true,
    initial: (file) => fs.symlinkSync("original.md", file),
    plan: (planner, file) => planner.delete(file, { owned: true, expectedKind: "symlink" }),
    change: (file) => {
      fs.unlinkSync(file);
      fs.writeFileSync(file, "User-authored replacement.\n");
    },
  },
  {
    name: "file replaced with a symlink before overwrite",
    posix: true,
    initial: (file) => fs.writeFileSync(file, "Original.\n"),
    plan: (planner, file) => planner.write(file, "Updated.\n", { owned: true }),
    change: (file) => {
      fs.unlinkSync(file);
      fs.symlinkSync("local.md", file);
    },
  },
];

for (const scenario of scenarios) {
  test(`apply refuses an outdated plan: ${scenario.name}`, {
    skip: scenario.posix && process.platform === "win32",
  }, (context) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-suitup-planner-"));
    const cwd = path.join(root, "project");
    const home = path.join(root, "home");
    fs.mkdirSync(cwd);
    fs.mkdirSync(home);
    context.after(() => fs.rmSync(root, { recursive: true, force: true }));

    // User-scope paths sort after project state, so a per-operation check
    // would already have changed the manifest before detecting this conflict.
    const file = path.join(home, "guidance.md");
    scenario.initial(file);
    const planner = new Planner({ cwd, home, force: scenario.force });
    scenario.plan(planner, file);
    const state = statePaths(cwd);
    fs.mkdirSync(state.directory);
    fs.writeFileSync(state.manifest, "{}\n");
    fs.writeFileSync(state.lock, "{}\n");
    planner.write(state.manifest, '{"components":[]}\n', { allowExisting: true });
    planner.write(state.lock, '{"components":{}}\n', { allowExisting: true });
    scenario.change(file);
    const before = snapshotTree(root);

    assert.throws(() => planner.apply(), (error) => {
      assert.ok(error instanceof ConflictError);
      assert.match(error.message, /changed after planning.*~\/guidance\.md/);
      assert.match(error.message, /[Rr]erun/);
      return true;
    });
    assert.deepEqual(snapshotTree(root), before);
  });
}

for (const failure of [
  {
    name: "write",
    method: "writeFileSync",
    plan: (planner, file) => planner.write(file, "Updated.\n", { owned: true }),
  },
  {
    name: "deletion",
    method: "unlinkSync",
    plan: (planner, file) => planner.delete(file, { owned: true, expectedKind: "file" }),
  },
]) {
  test(`a failed content ${failure.name} leaves stored state unchanged`, (context) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-suitup-planner-"));
    const cwd = path.join(root, "project");
    fs.mkdirSync(cwd);
    context.after(() => fs.rmSync(root, { recursive: true, force: true }));

    // Project content sorts after .agent-suitup, so label order alone would
    // record the new state before this change fails.
    const file = path.join(cwd, "AGENTS.md");
    fs.writeFileSync(file, "Original.\n");
    const state = statePaths(cwd);
    fs.mkdirSync(state.directory);
    fs.writeFileSync(state.manifest, "{}\n");
    fs.writeFileSync(state.lock, "{}\n");
    const planner = new Planner({ cwd, home: root });
    failure.plan(planner, file);
    planner.write(state.manifest, '{"components":[]}\n', { allowExisting: true });
    planner.write(state.lock, '{"components":{}}\n', { allowExisting: true });
    const before = snapshotTree(root);

    const original = fs[failure.method];
    context.mock.method(fs, failure.method, (target, ...rest) => {
      if (path.dirname(String(target)) === cwd) throw new Error(`Simulated ${failure.name} failure`);
      return original.call(fs, target, ...rest);
    });

    assert.throws(() => planner.apply(), new RegExp(`Simulated ${failure.name} failure`));
    assert.deepEqual(snapshotTree(root), before);
  });
}

test("a write beneath a deleted folder link replaces the link instead of its target", {
  skip: process.platform === "win32",
}, (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-suitup-planner-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "canonical"));
  fs.writeFileSync(path.join(root, "canonical", "SKILL.md"), "Canonical.\n");
  const link = path.join(root, "bridge");
  const plan = () => {
    const planner = new Planner({ cwd: root, home: root });
    planner.delete(link, { owned: true, expectedKind: "symlink", expectedTarget: "canonical" });
    planner.write(path.join(link, "SKILL.md"), "Wrapper.\n");
    return planner;
  };

  fs.symlinkSync("canonical", link, "dir");
  const retargeted = plan();
  fs.unlinkSync(link);
  fs.symlinkSync("elsewhere", link, "dir");
  assert.throws(() => retargeted.apply(), /changed after planning.*\.\/bridge\./);

  fs.unlinkSync(link);
  fs.symlinkSync("canonical", link, "dir");
  const planner = plan();
  assert.deepEqual(planner.operations().map(({ label, before }) => [label, before.kind]),
    [["./bridge", "symlink"], ["./bridge/SKILL.md", "missing"]]);
  planner.apply();
  assert.equal(fs.lstatSync(link).isDirectory(), true);
  assert.equal(fs.readFileSync(path.join(link, "SKILL.md"), "utf8"), "Wrapper.\n");
  assert.equal(fs.readFileSync(path.join(root, "canonical", "SKILL.md"), "utf8"), "Canonical.\n");
});

test("writes preserve owner permission bits and change only the executable bit", {
  skip: process.platform === "win32",
}, (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-suitup-planner-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = (name, content, mode) => {
    const absolute = path.join(root, name);
    fs.writeFileSync(absolute, content);
    fs.chmodSync(absolute, mode);
    return absolute;
  };
  const shared = file("AGENTS.md", "Same.\n", 0o664);
  const skill = file("SKILL.md", "Same.\n", 0o664);
  const script = file("run.sh", "Same.\n", 0o664);
  const edited = file("NOTES.md", "Before.\n", 0o600);

  const planner = new Planner({ cwd: root, home: root });
  planner.write(shared, "Same.\n", { allowExisting: true });
  planner.write(skill, "Same.\n", { mode: 0o644, owned: true });
  planner.write(script, "Same.\n", { mode: 0o755, owned: true });
  planner.write(edited, "After.\n", { allowExisting: true });

  assert.deepEqual(planner.operations().map(({ label }) => label), ["./NOTES.md", "./run.sh"]);
  // A mode-only change names the modes instead of printing an empty diff.
  assert.ok(formatPlan(planner).endsWith("\n\nUPDATE ./run.sh (mode 664 -> 775)"), formatPlan(planner));
  planner.apply();
  assert.equal(fs.statSync(script).mode & 0o777, 0o775);
  assert.equal(fs.statSync(edited).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(edited, "utf8"), "After.\n");
});

function snapshotTree(directory) {
  return Object.fromEntries(fs.readdirSync(directory).sort().map((name) => {
    const file = path.join(directory, name);
    const stat = fs.lstatSync(file);
    const mode = stat.mode & 0o777;
    if (stat.isSymbolicLink()) return [name, { target: fs.readlinkSync(file), mode }];
    if (stat.isDirectory()) return [name, { entries: snapshotTree(file), mode }];
    return [name, { content: fs.readFileSync(file, "utf8"), mode }];
  }));
}
