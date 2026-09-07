import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ConflictError, Planner } from "../src/planner.mjs";
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
    plan: (planner, file) => planner.write(file, "Agent Suitup content.\n"),
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
    planner.write(state.lock, '{"components":{},"bridges":{}}\n', { allowExisting: true });
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
