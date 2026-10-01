import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { getComponent } from "../src/catalog.mjs";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repository, "bin", "agent-suitup.mjs");

test("non-interactive init treats an empty selection as a successful no-op", (context) => {
  const fixture = makeFixture(context);
  const initialized = run(fixture, "init", "--yes");
  assert.equal(initialized.status, 0, initialized.stderr);
  assert.match(initialized.stdout, /no components installed automatically/i);
  assert.match(initialized.stdout, /Repository left unchanged/);
  assert.deepEqual(fs.readdirSync(fixture.project), []);
});

test("non-interactive assessment never treats stack or adapter signals as consent", (context) => {
  const fixture = makeFixture(context);
  fs.mkdirSync(path.join(fixture.project, ".git"));
  fs.mkdirSync(path.join(fixture.project, ".github", "workflows"), { recursive: true });
  fs.writeFileSync(path.join(fixture.project, "package.json"), JSON.stringify({
    devDependencies: { typescript: "^5.0.0" },
  }));
  fs.writeFileSync(path.join(fixture.project, "README.md"), "# Project\n");

  const adapted = run(fixture, "init", "--yes", "--adapter", "claude");
  assert.equal(adapted.status, 0, adapted.stderr);
  assert.match(adapted.stdout, /1 suggested/);
  assert.equal(fs.existsSync(path.join(fixture.project, ".agent-suitup")), false);
  assert.equal(fs.existsSync(path.join(fixture.project, "AGENTS.md")), false);
  assert.equal(fs.existsSync(path.join(fixture.project, "CLAUDE.md")), false);
});

test("non-interactive assessment leaves missing installed content for explicit repair", (context) => {
  const fixture = makeFixture(context);
  const added = run(fixture, "add", "block/tdd");
  assert.equal(added.status, 0, added.stderr);
  const original = read(fixture.project, "AGENTS.md");
  fs.unlinkSync(path.join(fixture.project, "AGENTS.md"));
  const before = snapshotTree(fixture.root);

  const assessed = run(fixture, "init", "--yes");
  assert.equal(assessed.status, 0, assessed.stderr);
  assert.match(assessed.stdout, /Assessment complete/);
  assert.match(assessed.stdout, /Repository left unchanged/);
  assert.doesNotMatch(assessed.stdout, /Healthy|agent-suitup ready|Change set/);
  assert.deepEqual(snapshotTree(fixture.root), before);

  assert.equal(run(fixture, "doctor").status, 1);
  const repaired = run(fixture, "update");
  assert.equal(repaired.status, 0, repaired.stderr);
  assert.equal(read(fixture.project, "AGENTS.md"), original);
});

test("non-interactive assessment preserves local drift even with force", (context) => {
  const fixture = makeFixture(context);
  const added = run(fixture, "add", "block/tdd");
  assert.equal(added.status, 0, added.stderr);
  const instructions = path.join(fixture.project, "AGENTS.md");
  fs.writeFileSync(instructions, read(fixture.project, "AGENTS.md")
    .replace("For features and bug fixes:", "For parser bug fixes only:"));
  const before = snapshotTree(fixture.root);

  for (const flags of [[], ["--force"]]) {
    const assessed = run(fixture, "init", "--yes", ...flags);
    assert.equal(assessed.status, 0, assessed.stderr);
    assert.match(assessed.stdout, /Repository left unchanged/);
    assert.deepEqual(snapshotTree(fixture.root), before);
  }
});

test("non-interactive assessment cannot enable or disable existing adapters", (context) => {
  for (const adapter of ["none", "claude"]) {
    const fixture = makeFixture(context);
    const components = ["block/tdd", "command/commit-work"];
    if (adapter === "claude") components.push("plugin/github");
    const added = run(fixture, "add", ...components, "--adapter", adapter);
    assert.equal(added.status, 0, added.stderr);
    const before = snapshotTree(fixture.root);

    const assessed = run(fixture, "init", "--yes", "--force", "--scope", "user",
      "--adapter", adapter === "none" ? "claude" : "none");
    assert.equal(assessed.status, 0, assessed.stderr);
    assert.match(assessed.stdout, /Repository left unchanged/);
    assert.deepEqual(snapshotTree(fixture.root), before);
  }
});

test("pre-rename manifests and target flags are rejected without changes", (context) => {
  const fixture = makeFixture(context);
  fs.mkdirSync(path.join(fixture.project, ".agent-suitup"));
  fs.writeFileSync(path.join(fixture.project, ".agent-suitup", "manifest.json"), JSON.stringify({
    manifestVersion: 1,
    targets: ["codex"],
    components: [{ id: "block/tdd", scope: "project" }],
  }));
  const before = snapshotTree(fixture.root);

  for (const arguments_ of [["init", "--yes"], ["add", "block/tdd"], ["doctor"]]) {
    const refused = run(fixture, ...arguments_);
    assert.equal(refused.status, 1, refused.stdout);
    assert.match(refused.stderr, /Unsupported manifest version/);
  }
  const flag = run(fixture, "add", "block/tdd", "--target", "claude");
  assert.equal(flag.status, 1);
  assert.match(flag.stderr, /Unknown flag: --target/);
  assert.deepEqual(snapshotTree(fixture.root), before);
});

test("interactive init asks for agents first and installs a block through the rules link", async (context) => {
  const fixture = makeFixture(context);
  const initialized = await runInteractive(fixture, [
    [/Your agents/, "codex"],
    [/Select numbers or ranges/, "1"],
    [/Install this selection/, "y"],
  ], "init", "--interactive");
  assert.equal(initialized.status, 0, initialized.stderr);
  assert.match(initialized.stdout, /Which coding agents do you use\?\n.*\n  all  All agents\s+recommended · every item works in every agent\n  1    Claude Code[\s\S]*2    Codex[\s\S]*3    Grok Build/);
  assert.match(initialized.stdout, /Agents: Codex/);
  assert.match(initialized.stdout, /Blocks \(9\)/);
  assert.match(initialized.stdout, /Always-on rules in \.agents\/rules\.md, linked from AGENTS\.md/);
  assert.match(initialized.stdout, /01 · block\/tdd[\s\S]*72 words/);
  assert.doesNotMatch(initialized.stdout, /Install them for/);
  assert.match(initialized.stdout, /1 Agents[\s\S]*2 Choose[\s\S]*3 Review/);
  assert.match(initialized.stdout, /Skills \(3\)[\s\S]*Skill commands \(1\)/);
  assert.doesNotMatch(initialized.stdout, /Integrations \(5\)/, "Claude Code plugins need Claude Code");
  assert.match(initialized.stdout, /AGENTS\.md  adds a one-line link to \.agents\/rules\.md/);
  assert.match(initialized.stdout, /agent-suitup ready[\s\S]*More\s+agent-suitup add --interactive/);

  const manifest = JSON.parse(read(fixture.project, ".agent-suitup/manifest.json"));
  assert.deepEqual(manifest.adapters, ["codex"]);
  assert.deepEqual(manifest.components.map(({ id }) => id), ["block/tdd"]);
  assert.match(read(fixture.project, ".agents/rules.md"), /<!--as:block\/tdd-->\n## Test-driven development/);
  assert.equal(read(fixture.project, "AGENTS.md"),
    "<!--as:rules-->\nProject rules: read and follow @.agents/rules.md before starting any task.\n<!--/as:rules-->\n");
  assert.equal(fs.existsSync(path.join(fixture.project, "CLAUDE.md")), false);
});

test("interactive init confirms the aggregate cost before installing every block", async (context) => {
  const fixture = makeFixture(context);
  const initialized = await runInteractive(fixture, [
    [/Your agents/, "2"],
    [/Select numbers or ranges/, "1-9"],
    [/Install this selection/, "y"],
  ], "init", "--interactive");
  assert.equal(initialized.status, 0, initialized.stderr);
  assert.match(initialized.stdout, /Always on\s+591 words · ~963 tokens per session/);

  const manifest = JSON.parse(read(fixture.project, ".agent-suitup/manifest.json"));
  assert.equal(manifest.components.length, 9);
  assert.ok(manifest.components.every(({ id }) => id.startsWith("block/")));
  assert.deepEqual(manifest.adapters, ["codex"]);
  assert.equal(count(read(fixture.project, "AGENTS.md"), "@.agents/rules.md"), 1, "all blocks share one link");
});

test("interactive init can browse the whole catalog and skip installation", async (context) => {
  const fixture = makeFixture(context);
  const initialized = await runInteractive(fixture, [
    [/Your agents/, "claude code, grok"],
    [/Select numbers or ranges/, "none"],
  ], "init", "--interactive");
  assert.equal(initialized.status, 0, initialized.stderr);
  assert.match(initialized.stdout, /Agents: Claude Code, Grok Build/);
  assert.match(initialized.stdout, /Integrations \(5\)/);
  assert.match(initialized.stdout, /Repository left unchanged/);
  assert.deepEqual(fs.readdirSync(fixture.project), []);
});

test("interactive init leaves an existing installation unchanged when all selections are skipped", async (context) => {
  const fixture = makeFixture(context);
  const added = run(fixture, "add", "block/tdd");
  assert.equal(added.status, 0, added.stderr);
  fs.unlinkSync(path.join(fixture.project, "AGENTS.md"));
  const before = snapshotTree(fixture.root);

  const initialized = await runInteractive(fixture, [
    [/Select numbers or ranges/, "none"],
  ], "init", "--interactive", "--adapter", "claude");
  assert.equal(initialized.status, 0, initialized.stderr);
  assert.match(initialized.stdout, /Repository left unchanged/);
  assert.doesNotMatch(initialized.stdout, /Healthy|agent-suitup ready|Change set/);
  assert.deepEqual(snapshotTree(fixture.root), before);
});

test("interactive init preserves local edits when a forced plan is declined", async (context) => {
  const fixture = makeFixture(context);
  const added = run(fixture, "add", "block/tdd", "plugin/github");
  assert.equal(added.status, 0, added.stderr);
  fs.writeFileSync(path.join(fixture.project, ".agents/rules.md"), read(fixture.project, ".agents/rules.md")
    .replace("For features and bug fixes,", "For parser bug fixes only,"));
  const before = snapshotTree(fixture.root);

  const initialized = await runInteractive(fixture, [
    [/Your agents/, ""],
    [/Select numbers or ranges/, "1-9"],
    [/Install this selection/, "n"],
  ], "init", "--interactive", "--force");
  assert.equal(initialized.status, 0, initialized.stderr);
  assert.match(initialized.stdout, /Installation cancelled. No files written/);
  assert.deepEqual(snapshotTree(fixture.root), before);
});

test("interactive init preserves existing state when the catalog selection is abandoned", async (context) => {
  const fixture = makeFixture(context);
  const added = run(fixture, "add", "block/tdd", "command/commit-work");
  assert.equal(added.status, 0, added.stderr);
  fs.unlinkSync(path.join(fixture.project, ".agents", "skills", "commit-work", "SKILL.md"));
  const before = snapshotTree(fixture.root);

  const initialized = await runInteractive(fixture, [
    [/Select numbers or ranges/, "none"],
  ], "init", "--interactive", "--adapter", "claude");
  assert.equal(initialized.status, 0, initialized.stderr);
  assert.match(initialized.stdout, /Repository left unchanged/);
  assert.deepEqual(snapshotTree(fixture.root), before);
});

test("interactive init leaves fully selected block installations unchanged", async (context) => {
  const fixture = makeFixture(context);
  const catalog = JSON.parse(fs.readFileSync(path.join(repository, "catalog", "catalog.json"), "utf8"));
  const blockIds = catalog.components.filter(({ kind }) => kind === "block").map(({ id }) => id);
  const added = run(fixture, "add", ...blockIds);
  assert.equal(added.status, 0, added.stderr);
  fs.unlinkSync(path.join(fixture.project, ".agents/rules.md"));
  const before = snapshotTree(fixture.root);

  const initialized = await runInteractive(fixture, [
    [/Your agents/, "codex"],
    [/Select numbers or ranges/, "1-9"],
  ], "init", "--interactive");
  assert.equal(initialized.status, 0, initialized.stderr);
  assert.match(initialized.stdout, /block\/tdd[^\n]*installed/);
  assert.match(initialized.stdout, /Repository left unchanged/);
  assert.deepEqual(snapshotTree(fixture.root), before);
});

test("interactive init still adds an explicit component to an existing installation", async (context) => {
  const fixture = makeFixture(context);
  const added = run(fixture, "add", "block/tdd");
  assert.equal(added.status, 0, added.stderr);

  const initialized = await runInteractive(fixture, [
    [/Your agents/, "codex"],
    [/Select numbers or ranges/, "block/ponytail"],
    [/Install this selection/, "y"],
  ], "init", "--interactive");
  assert.equal(initialized.status, 0, initialized.stderr);
  const manifest = JSON.parse(read(fixture.project, ".agent-suitup/manifest.json"));
  assert.deepEqual(manifest.components.map(({ id }) => id), ["block/ponytail", "block/tdd"]);
  assert.match(read(fixture.project, ".agents/rules.md"), /<!--as:block\/ponytail-->/);
  assert.match(run(fixture, "doctor").stdout, /Healthy.*2 components/);
});

test("interactive init installs a plugin directly from the unified catalog", async (context) => {
  const fixture = makeFixture(context);
  const initialized = await runInteractive(fixture, [
    [/Your agents/, "1"],
    [/Select numbers or ranges/, "plugin/frontend-design"],
    [/Install this selection/, "y"],
  ], "init", "--interactive");
  assert.equal(initialized.status, 0, initialized.stderr);
  assert.match(initialized.stdout, /Integrations \(5\)/);
  assert.match(initialized.stdout, /14 · plugin\/frontend-design/);

  const manifest = JSON.parse(read(fixture.project, ".agent-suitup/manifest.json"));
  assert.deepEqual(manifest.adapters, ["claude"]);
  assert.deepEqual(manifest.components.map(({ id }) => id), ["plugin/frontend-design"]);
  assert.equal(fs.existsSync(path.join(fixture.project, "AGENTS.md")), false);
  assert.equal(fs.existsSync(path.join(fixture.project, "CLAUDE.md")), false);
  const settings = JSON.parse(read(fixture.project, ".claude/settings.json"));
  assert.equal(settings.enabledPlugins["frontend-design@claude-plugins-official"], true);
});

test("init installs skills into each chosen agent's folder", (context) => {
  for (const [agent, scope] of [["codex", "project"], ["claude", "project"], ["claude", "user"]]) {
    const fixture = makeFixture(context);
    const result = spawnSync(process.execPath, [cli, "init", "--interactive"], {
      cwd: fixture.project,
      env: { ...process.env, HOME: fixture.home, USERPROFILE: fixture.home, NO_COLOR: "1" },
      encoding: "utf8", input: `${agent}\ni skill/audit-docs\n${scope === "user" ? "u\n" : ""}skill/audit-docs\ny\n`, timeout: 5_000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Use when[\s\S]*Example[\s\S]*Consider[\s\S]*Files[\s\S]*SKILL\.md\n[\s\S]*│ name: audit-docs/);
    assert.match(result.stdout, agent === "claude" ? /\.claude\/skills\/audit-docs\s+Claude Code reads it here/ : /\.agents\/skills\/audit-docs\/\s+Codex reads it here/);
    assert.match(result.stdout, /Ask your agent: "Use audit-docs/);
    const root = scope === "user" ? fixture.home : fixture.project;
    assert.match(read(root, ".agents/skills/audit-docs/SKILL.md"), /name: audit-docs/);
    assert.equal(fs.existsSync(path.join(fixture.project, "AGENTS.md")), false, "skills do not need instruction blocks");
    assert.equal(fs.existsSync(path.join(root, ".claude/skills/audit-docs/SKILL.md")), agent === "claude");
    const manifest = JSON.parse(read(fixture.project, ".agent-suitup/manifest.json"));
    assert.deepEqual(manifest.components, [{ id: "skill/audit-docs", scope }]);
    assert.deepEqual(manifest.adapters, [agent]);
    assert.match(run(fixture, "doctor").stdout, /Healthy.*1 component/);
  }
});

test("inspect and in-menu guides are read-only, including remote skills", async (context) => {
  const fixture = makeFixture(context);
  const before = snapshotTree(fixture.root);
  const result = run(fixture, "inspect", "skill/fastapi", "--scope", "user", "--adapter", "claude");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Use when[\s\S]*FastAPI application/);
  assert.match(result.stdout, /~\/\.agents\/skills\/fastapi\/\s+source files/);
  assert.match(result.stdout, /~\/\.claude\/skills\/fastapi\s+Claude Code reads it here/);
  assert.match(result.stdout, /Downloaded from fastapi\/fastapi at 192b121 when you install it/);
  assert.match(result.stdout, /agent-suitup adds this section at the top:[\s\S]*│ ## Project compatibility/);
  assert.match(result.stdout, /Install  agent-suitup add skill\/fastapi --scope user --agent claude/);
  const everyAgent = run(fixture, "inspect", "skill/fastapi");
  assert.match(everyAgent.stdout, /\.agents\/skills\/fastapi\/\s+Codex and Grok Build read it here\n\s+\.claude\/skills\/fastapi\s+Claude Code/);
  const menu = await runInteractive(fixture, [
    [/Your agents/, "codex"],
    [/Select numbers or ranges/, "i 10"],
    [/Select numbers or ranges/, "i skill/fastapi"],
    [/Select numbers or ranges/, "none"],
  ], "init", "--interactive");
  assert.equal(menu.status, 0, menu.stderr);
  assert.match(menu.stdout, /Documentation audit[\s\S]*Example\s+Ask: Use audit-docs/);
  assert.deepEqual(snapshotTree(fixture.root), before);
});

for (const adapter of ["none", "claude", "grok"]) {
  for (const scope of ["project", "user"]) {
    test(`bundled skills support ${scope} lifecycle with ${adapter} delivery`, (context) => {
      const fixture = makeFixture(context);
      const names = ["audit-docs"];
      const ids = names.map((name) => `skill/${name}`);
      const root = scope === "user" ? fixture.home : fixture.project;
      const otherRoot = scope === "user" ? fixture.project : fixture.home;
      const canonical = (name) => `.agents/skills/${name}/SKILL.md`;
      const expected = (name) => read(repository, `catalog/skills/${name}/SKILL.md`);
      const args = [...ids, "--scope", scope, "--adapter", adapter];
      const before = snapshotTree(fixture.root);

      const listed = run(fixture, "list", "skills");
      assert.equal(listed.status, 0, listed.stderr);
      for (const id of ids) {
        assert.ok(listed.stdout.includes(id), id);
        const inspected = run(fixture, "inspect", id, "--scope", scope, "--adapter", adapter);
        assert.equal(inspected.status, 0, inspected.stderr);
        assert.match(inspected.stdout, /loads when relevant/);
      }
      const preview = run(fixture, "add", ...args, "--dry-run");
      assert.equal(preview.status, 0, preview.stderr);
      assert.deepEqual(snapshotTree(fixture.root), before);

      const installed = run(fixture, "add", ...args);
      assert.equal(installed.status, 0, installed.stderr);
      for (const name of names) {
        assert.equal(read(root, canonical(name)), expected(name));
        assert.equal(fs.existsSync(path.join(otherRoot, canonical(name))), false);
        const bridge = path.join(root, ".claude", "skills", name);
        if (adapter === "claude") {
          assert.ok(fs.lstatSync(bridge).isSymbolicLink());
          assert.equal(fs.realpathSync(bridge), fs.realpathSync(path.dirname(path.join(root, canonical(name)))));
        } else assert.equal(fs.existsSync(bridge), false);
      }
      assert.equal(fs.existsSync(path.join(fixture.project, "AGENTS.md")), false);
      const manifest = JSON.parse(read(fixture.project, ".agent-suitup/manifest.json"));
      assert.deepEqual(manifest.components, [...ids].sort().map((id) => ({ id, scope })));
      const lock = JSON.parse(read(fixture.project, ".agent-suitup/lock.json"));
      for (const id of ids) {
        assert.equal(lock.components[id].version, getComponent(id).version);
        assert.equal(lock.components[id].scope, scope);
        assert.equal(lock.components[id].source.kind, "bundled");
      }

      const unchanged = snapshotTree(fixture.root);
      const repeated = run(fixture, "add", ...args);
      assert.equal(repeated.status, 0, repeated.stderr);
      assert.match(repeated.stdout, /^No file changes\./);
      assert.deepEqual(snapshotTree(fixture.root), unchanged);
      const healthy = run(fixture, "doctor");
      assert.equal(healthy.status, 0, healthy.stderr);

      fs.unlinkSync(path.join(root, canonical(names[0])));
      const repaired = run(fixture, "update");
      assert.equal(repaired.status, 0, repaired.stderr);
      assert.equal(read(root, canonical(names[0])), expected(names[0]));

      const note = `.agents/skills/${names[0]}/local-notes.md`;
      fs.writeFileSync(path.join(root, note), "Keep this unowned note.\n");
      const removed = run(fixture, "remove", ...ids);
      assert.equal(removed.status, 0, removed.stderr);
      for (const name of names) {
        assert.equal(fs.existsSync(path.join(root, canonical(name))), false);
        assert.equal(fs.existsSync(path.join(root, ".claude", "skills", name)), false);
      }
      assert.equal(read(root, note), "Keep this unowned note.\n");
      assert.deepEqual(JSON.parse(read(fixture.project, ".agent-suitup/manifest.json")).components, []);
    });
  }
}

test("mixed selections preserve required adapters and never infer blocks from skills", (context) => {
  const fixture = makeFixture(context);
  const result = spawnSync(process.execPath, [cli, "init", "--interactive"], {
    cwd: fixture.project,
    env: { ...process.env, HOME: fixture.home, USERPROFILE: fixture.home, NO_COLOR: "1" },
    encoding: "utf8", input: "claude\nskill/audit-docs command/commit-work plugin/github\nproject\ny\n", timeout: 5_000,
  });
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(read(fixture.project, ".agent-suitup/manifest.json"));
  assert.deepEqual(manifest.adapters, ["claude"]);
  assert.deepEqual(manifest.components.map(({ id }) => id), ["command/commit-work", "plugin/github", "skill/audit-docs"]);
  assert.equal(fs.existsSync(path.join(fixture.project, "AGENTS.md")), false);
  assert.match(run(fixture, "doctor").stdout, /Healthy.*3 components/);
});

test("interactive review previews exact changes and can cancel without writing", async (context) => {
  const fixture = makeFixture(context);
  fs.writeFileSync(path.join(fixture.project, "AGENTS.md"), "# Existing guidance\n");
  const before = snapshotTree(fixture.root);
  const result = await runInteractive(fixture, [
    [/Your agents/, "codex"],
    [/Select numbers or ranges/, "3"],
    [/Install this selection/, () => {
      assert.deepEqual(snapshotTree(fixture.root), before);
      return "p";
    }],
    [/Install this selection/, "n"],
  ], "init", "--interactive", "--plain");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Ready to install\n│ Agents\s+Codex\n│ Install for\s+this project\n│\n│ Blocks \(1\)\s+Completion evidence/);
  assert.match(result.stdout, /Files\s+3 new · 1 changed\n│   \+ \.agents\/rules\.md\n│   ~ AGENTS\.md  adds a one-line link[\s\S]*\+ \.agent-suitup\/lock\.json  agent-suitup state/);
  assert.match(result.stdout, /CREATE \.\/\.agents\/rules\.md\n\+<!--as:block\/completion-evidence-->\n\+## Completion evidence/);
  assert.match(result.stdout, /UPDATE \.\/AGENTS\.md\n[^+]*\+<!--as:rules-->\n\+Project rules: read and follow @\.agents\/rules\.md/);
  assert.match(result.stdout, /Installation cancelled. No files written/);
  assert.doesNotMatch(result.stdout, /\x1b\[/);
  assert.deepEqual(snapshotTree(fixture.root), before);
});

test("interactive add recovers from typos and installs the chosen user scope", async (context) => {
  const fixture = makeFixture(context);
  const result = await runInteractive(fixture, [
    [/Your agents/, "codex"],
    [/Select numbers or ranges/, "1-999999999999"],
    [/Select numbers or ranges/, "u"],
    [/Select numbers or ranges/, "command/commit-work"],
    [/Install this selection/, "maybe"],
    [/Install this selection/, "y"],
  ], "add", "--interactive");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Invalid selection/);
  assert.match(result.stdout, /Install for: this project\. Type u[\s\S]*Install for: all projects, in your home folder/);
  assert.doesNotMatch(result.stdout, /Install them for/);
  assert.match(result.stdout, /Install for\s+all projects, in your home folder\n[\s\S]*Skill commands \(1\)\s+Commit work\n/);
  assert.match(read(fixture.home, ".agents/skills/commit-work/SKILL.md"), /# Commit Work/);
  const manifest = JSON.parse(read(fixture.project, ".agent-suitup/manifest.json"));
  assert.deepEqual(manifest.components, [{ id: "command/commit-work", scope: "user" }]);
});

test("b steps back from the review and the catalog, keeping earlier choices", async (context) => {
  const fixture = makeFixture(context);
  const result = await runInteractive(fixture, [
    [/Your agents/, "codex"],
    [/or b to go back to agents[\s\S]*Select numbers or ranges \[none\]/, "skill/audit-docs"],
    [/Install this selection\? \[Y\/n · b back · p preview\]/, "b"],
    [/Select numbers or ranges \[skill\/audit-docs\]/, "b"],
    [/Your agents/, "claude"],
    [/Select numbers or ranges \[skill\/audit-docs\]/, ""],
    [/Install this selection/, "y"],
  ], "init", "--interactive");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Agents: Codex[\s\S]*Selected: Documentation audit[\s\S]*Agents: Claude Code[\s\S]*Selected: Documentation audit/);
  const manifest = JSON.parse(read(fixture.project, ".agent-suitup/manifest.json"));
  assert.deepEqual(manifest.adapters, ["claude"]);
  assert.deepEqual(manifest.components, [{ id: "skill/audit-docs", scope: "project" }]);
  assert.ok(fs.existsSync(path.join(fixture.project, ".claude/skills/audit-docs")));
});

test("with --agent there is no agent step to go back to, but the review still returns to the catalog", async (context) => {
  const fixture = makeFixture(context);
  const result = await runInteractive(fixture, [
    [/Select numbers or ranges \[none\]/, "b"],
    [/Select numbers or ranges \[none\]/, "1"],
    [/Install this selection/, "b"],
    [/Select numbers or ranges \[block\/tdd\]/, ""],
    [/Install this selection/, "y"],
  ], "add", "--interactive", "--adapter", "codex");
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /go back to agents|Your agents/);
  assert.match(result.stdout, /Invalid selection: b/);
  assert.deepEqual(JSON.parse(read(fixture.project, ".agent-suitup/manifest.json")).components, [{ id: "block/tdd", scope: "project" }]);
});

test("pressing Enter at the agent question sets up every agent", async (context) => {
  const fixture = makeFixture(context);
  const result = await runInteractive(fixture, [
    [/Your agents \(all, or numbers or names, e\.g\. 1,3\) \[all\]/, ""],
    [/Select numbers or ranges/, "command/commit-work"],
    [/Install this selection/, "y"],
  ], "init", "--interactive");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Agents: Claude Code, Codex, Grok Build/);
  assert.match(result.stdout, /Integrations \(5\)/);
  assert.deepEqual(JSON.parse(read(fixture.project, ".agent-suitup/manifest.json")).adapters, ["claude", "codex", "grok"]);
  for (const agent of ["claude", "grok"]) {
    assert.match(read(fixture.project, `.${agent}/skills/commit-work/SKILL.md`), /disable-model-invocation: true/);
  }
  assert.match(read(fixture.project, ".agents/skills/commit-work/agents/openai.yaml"), /allow_implicit_invocation: false/);
});

test("interactive init recovers from an invalid agent choice", async (context) => {
  const fixture = makeFixture(context);
  const result = await runInteractive(fixture, [
    [/Your agents/, "cloude"],
    [/Your agents/, "claude"],
    [/Select numbers or ranges/, "skill/audit-docs"],
    [/Install this selection/, "n"],
  ], "init", "--interactive");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Unknown agent: cloude/);
  assert.match(result.stdout, /\.claude\/skills\/audit-docs/);
  assert.deepEqual(fs.readdirSync(fixture.project), []);
});

test("interactive dry run needs no install confirmation and leaves no state", async (context) => {
  const fixture = makeFixture(context);
  const result = await runInteractive(fixture, [
    [/Your agents/, "grok"],
    [/Select numbers or ranges/, "1"],
  ], "add", "--interactive", "--dry-run");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /CREATE \.\/\.agents\/rules\.md[\s\S]*CREATE \.\/AGENTS\.md[\s\S]*Dry run complete/);
  assert.doesNotMatch(result.stdout, /Install this selection|Install them for/);
  assert.deepEqual(fs.readdirSync(fixture.project), []);
});

test("piped answers work when sent together and EOF never approves an installation", (context) => {
  for (const [input, expectedStatus] of [["codex\n1\ny\n", 0], ["codex\n1\n", 130], ["", 130]]) {
    const fixture = makeFixture(context);
    const result = spawnSync(process.execPath, [cli, "init", "--interactive"], {
      cwd: fixture.project,
      env: { ...process.env, HOME: fixture.home, USERPROFILE: fixture.home, NO_COLOR: "1" },
      encoding: "utf8", input, timeout: 5_000,
    });
    assert.equal(result.status, expectedStatus, result.stderr);
    if (expectedStatus === 0) assert.match(read(fixture.project, ".agents/rules.md"), /<!--as:block\/tdd-->/);
    else {
      assert.match(result.stdout, /Setup cancelled. No files written/);
      assert.deepEqual(fs.readdirSync(fixture.project), []);
    }
  }
});

test("review includes existing block cost and rechecks files changed while waiting", async (context) => {
  const fixture = makeFixture(context);
  assert.equal(run(fixture, "add", "block/tdd").status, 0);
  let before;
  const result = await runInteractive(fixture, [
    [/Your agents/, "codex"],
    [/Select numbers or ranges/, "block/ponytail"],
    [/Install this selection/, () => {
      fs.appendFileSync(path.join(fixture.project, ".agents/rules.md"), "\nNew guidance during review.\n");
      before = snapshotTree(fixture.root);
      return "y";
    }],
  ], "init", "--interactive", "--force");
  assert.equal(result.status, 1);
  assert.match(result.stdout, /Always on\s+139 words · ~241 tokens per session/);
  assert.match(result.stderr, /Path changed after planning: \.\/\.agents\/rules\.md/);
  assert.deepEqual(snapshotTree(fixture.root), before);
});

test("portable content installs canonically without vendor files", (context) => {
  const fixture = makeFixture(context);
  fs.writeFileSync(path.join(fixture.project, "AGENTS.md"), "# Team instructions\n\nKeep this text.\n");
  fs.writeFileSync(path.join(fixture.project, "CLAUDE.md"), "# Claude notes\n");

  const installed = run(fixture, "add", "block/tdd", "skill/audit-docs", "--agent", "none");
  assert.equal(installed.status, 0, installed.stderr);
  const manifest = JSON.parse(read(fixture.project, ".agent-suitup/manifest.json"));
  assert.deepEqual(manifest.adapters, []);
  const agents = read(fixture.project, "AGENTS.md");
  assert.match(agents, /Keep this text/);
  assert.equal(count(agents, "@.agents/rules.md"), 1);
  assert.equal(count(read(fixture.project, ".agents/rules.md"), "<!--as:block/tdd-->"), 1);
  assert.doesNotMatch(installed.stdout, /Claude Code reads/, "without Claude Code, CLAUDE.md is irrelevant");

  const claude = read(fixture.project, "CLAUDE.md");
  assert.equal(claude, "# Claude notes\n");
  assert.ok(fs.existsSync(path.join(fixture.project, ".agents", "skills", "audit-docs", "SKILL.md")));
  assert.equal(fs.existsSync(path.join(fixture.project, ".claude")), false);

  const planned = run(fixture, "plan");
  assert.equal(planned.status, 0, planned.stderr);
  assert.match(planned.stdout, /Always on\s+72 words/);
  assert.match(planned.stdout, /No file changes\./);
  const healthy = run(fixture, "doctor");
  assert.equal(healthy.status, 0, healthy.stderr);
  assert.match(healthy.stdout, /Healthy.*2 components/);

  const repeated = run(fixture, "add", "block/tdd", "skill/audit-docs");
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.match(repeated.stdout, /^No file changes\./);

  const removed = run(fixture, "remove", "block/tdd", "skill/audit-docs");
  assert.equal(removed.status, 0, removed.stderr);
  assert.equal(read(fixture.project, "AGENTS.md"), "# Team instructions\n\nKeep this text.\n");
  assert.equal(fs.existsSync(path.join(fixture.project, ".agents", "rules.md")), false);
  const claudeAfter = read(fixture.project, "CLAUDE.md");
  assert.equal(claudeAfter, "# Claude notes\n");
});

for (const adapter of ["none", "claude"]) {
  test(`focused changes installs and removes only owned project instructions with ${adapter} delivery`, (context) => {
    const fixture = makeFixture(context);
    const id = "block/focused-changes";
    const original = "# Project guidance\n\nKeep our existing instructions.\n";
    const body = read(repository, "catalog/blocks/focused-changes.md");
    fs.writeFileSync(path.join(fixture.project, "AGENTS.md"), original);
    const before = snapshotTree(fixture.root);

    const invalidScope = run(fixture, "add", id, "--scope", "user");
    assert.notEqual(invalidScope.status, 0);
    assert.deepEqual(snapshotTree(fixture.root), before);
    const preview = run(fixture, "add", id, "--adapter", adapter, "--dry-run");
    assert.equal(preview.status, 0, preview.stderr);
    assert.deepEqual(snapshotTree(fixture.root), before);

    const installed = run(fixture, "add", id, "--adapter", adapter);
    assert.equal(installed.status, 0, installed.stderr);
    assert.equal(read(fixture.project, "AGENTS.md"),
      `${original}\n<!--as:rules-->\nProject rules: read and follow @.agents/rules.md before starting any task.\n<!--/as:rules-->\n`);
    const instructions = read(fixture.project, ".agents/rules.md");
    assert.ok(instructions.includes(body));
    assert.equal(count(instructions, "<!--as:block/focused-changes-->"), 1);
    assert.equal(fs.existsSync(path.join(fixture.project, "CLAUDE.md")), false);
    const manifest = JSON.parse(read(fixture.project, ".agent-suitup/manifest.json"));
    assert.deepEqual(manifest.components, [{ id, scope: "project" }]);

    const unchanged = snapshotTree(fixture.root);
    const repeated = run(fixture, "add", id);
    assert.equal(repeated.status, 0, repeated.stderr);
    assert.deepEqual(snapshotTree(fixture.root), unchanged);
    const healthy = run(fixture, "doctor");
    assert.equal(healthy.status, 0, healthy.stderr);

    fs.writeFileSync(path.join(fixture.project, ".agents/rules.md"), instructions.replace(body, `${body}Local policy edit.\n`));
    const edited = snapshotTree(fixture.root);
    const conflict = run(fixture, "remove", id);
    assert.notEqual(conflict.status, 0);
    assert.match(conflict.stderr, /Managed block has local changes/);
    assert.deepEqual(snapshotTree(fixture.root), edited);

    fs.writeFileSync(path.join(fixture.project, ".agents/rules.md"), instructions);
    const removed = run(fixture, "remove", id);
    assert.equal(removed.status, 0, removed.stderr);
    assert.equal(read(fixture.project, "AGENTS.md"), original);
    assert.equal(fs.existsSync(path.join(fixture.project, ".agents")), false, "the created rules folder is cleaned up");
    assert.deepEqual(JSON.parse(read(fixture.project, ".agent-suitup/manifest.json")).components, []);
  });
}

test("block insertion order is deterministic and repeated application is idempotent", (context) => {
  const first = makeFixture(context);
  const second = makeFixture(context);
  for (const fixture of [first, second]) {
    fs.writeFileSync(path.join(fixture.project, "AGENTS.md"), "# User guidance\n\nKeep this text.\n");
  }

  const firstAdd = run(first, "add", "block/transparent-shortcuts", "block/completion-evidence");
  const secondAdd = run(second, "add", "block/completion-evidence", "block/transparent-shortcuts");
  assert.equal(firstAdd.status, 0, firstAdd.stderr);
  assert.equal(secondAdd.status, 0, secondAdd.stderr);
  const expected = read(first.project, ".agents/rules.md");
  assert.equal(read(second.project, ".agents/rules.md"), expected);
  assert.equal(read(second.project, "AGENTS.md"), read(first.project, "AGENTS.md"));
  assert.ok(read(first.project, "AGENTS.md").startsWith("# User guidance\n\nKeep this text.\n\n<!--as:rules-->"));
  assert.ok(expected.indexOf("<!--as:block/completion-evidence-->")
    < expected.indexOf("<!--as:block/transparent-shortcuts-->"));

  const repeated = run(first, "add", "block/transparent-shortcuts", "block/completion-evidence");
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.equal(repeated.stdout, "No file changes.\n");
  assert.equal(read(first.project, ".agents/rules.md"), expected);
});

test("block drift is refused and an explicit force restores only owned content", (context) => {
  const fixture = makeFixture(context);
  fs.writeFileSync(path.join(fixture.project, "AGENTS.md"), "# User guidance\n");
  assert.equal(run(fixture, "add", "block/tdd").status, 0);
  const rules = path.join(fixture.project, ".agents", "rules.md");
  fs.writeFileSync(rules, fs.readFileSync(rules, "utf8").replace("first write a test", "Locally edit TDD"));

  const doctor = run(fixture, "doctor");
  assert.equal(doctor.status, 1);
  assert.match(doctor.stderr, /Managed block has local changes: block\/tdd/);
  const refused = run(fixture, "add", "block/tdd");
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /Managed block has local changes/);

  const restored = run(fixture, "add", "block/tdd", "--force");
  assert.equal(restored.status, 0, restored.stderr);
  assert.match(read(fixture.project, "AGENTS.md"), /^# User guidance/m);
  assert.doesNotMatch(read(fixture.project, ".agents/rules.md"), /Locally edit/);
  assert.match(run(fixture, "doctor").stdout, /Healthy/);

  const removed = run(fixture, "remove", "block/tdd");
  assert.equal(removed.status, 0, removed.stderr);
  assert.equal(read(fixture.project, "AGENTS.md"), "# User guidance\n");
});

test("blocks embedded in AGENTS.md by earlier releases move to the rules file", (context) => {
  const fixture = makeFixture(context);
  fs.writeFileSync(path.join(fixture.project, "AGENTS.md"), "# Team guidance\n");
  assert.equal(run(fixture, "add", "block/tdd").status, 0);
  // Recreate the earlier layout: the block inside AGENTS.md and no rules file.
  const body = read(fixture.project, ".agents/rules.md");
  fs.writeFileSync(path.join(fixture.project, "AGENTS.md"), `# Team guidance\n\n${body}`);
  fs.rmSync(path.join(fixture.project, ".agents"), { recursive: true });
  const lockFile = path.join(fixture.project, ".agent-suitup", "lock.json");
  const lock = JSON.parse(fs.readFileSync(lockFile, "utf8"));
  const entry = lock.components["block/tdd"];
  entry.files = [{ ...entry.files.find(({ kind }) => kind === "block"), path: "./AGENTS.md", created: false }];
  fs.writeFileSync(lockFile, `${JSON.stringify(lock, null, 2)}\n`);
  const earlier = snapshotTree(fixture.root);

  const edited = read(fixture.project, "AGENTS.md").replace("first write a test", "Locally edit TDD");
  fs.writeFileSync(path.join(fixture.project, "AGENTS.md"), edited);
  const refused = run(fixture, "update");
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /Managed block has local changes: block\/tdd/);
  fs.writeFileSync(path.join(fixture.project, "AGENTS.md"), read(fixture.project, "AGENTS.md").replace("Locally edit TDD", "first write a test"));
  assert.deepEqual(snapshotTree(fixture.root), earlier);

  assert.equal(run(fixture, "doctor").status, 1);
  const migrated = run(fixture, "update");
  assert.equal(migrated.status, 0, migrated.stderr);
  assert.equal(read(fixture.project, "AGENTS.md"),
    "# Team guidance\n\n<!--as:rules-->\nProject rules: read and follow @.agents/rules.md before starting any task.\n<!--/as:rules-->\n");
  assert.equal(read(fixture.project, ".agents/rules.md"), body);
  assert.match(run(fixture, "doctor").stdout, /Healthy/);
  assert.equal(run(fixture, "remove", "block/tdd").status, 0);
  assert.equal(read(fixture.project, "AGENTS.md"), "# Team guidance\n");
  assert.equal(fs.existsSync(path.join(fixture.project, ".agents")), false);
});

test("the rules link is owned like a block and removed with the last block", (context) => {
  const fixture = makeFixture(context);
  assert.equal(run(fixture, "add", "block/tdd").status, 0);
  assert.equal(run(fixture, "add", "block/ponytail").status, 0);
  const lock = JSON.parse(read(fixture.project, ".agent-suitup/lock.json"));
  for (const id of ["block/tdd", "block/ponytail"]) {
    assert.deepEqual(lock.components[id].files.map(({ path: file, kind, created }) => [file, kind, created]),
      [["./.agents/rules.md", "block", true], ["./AGENTS.md", "link", true]], id);
  }

  const agents = path.join(fixture.project, "AGENTS.md");
  const linked = fs.readFileSync(agents, "utf8");
  fs.writeFileSync(agents, linked.replace("before starting any task", "sometimes"));
  const drift = run(fixture, "doctor");
  assert.equal(drift.status, 1);
  assert.match(drift.stderr, /local changes: AGENTS\.md link to the rules file/);
  assert.equal(run(fixture, "update", "--force").status, 0);
  assert.equal(fs.readFileSync(agents, "utf8"), linked);

  // The block added second still knows agent-suitup created both shared files.
  assert.equal(run(fixture, "remove", "block/tdd").status, 0);
  assert.equal(fs.readFileSync(agents, "utf8"), linked);
  assert.equal(run(fixture, "remove", "block/ponytail").status, 0);
  assert.deepEqual(fs.readdirSync(fixture.project), [".agent-suitup"]);
});

test("a component no longer in the catalog can still be removed safely", (context) => {
  const fixture = makeFixture(context);
  const state = path.join(fixture.project, ".agent-suitup");
  const skill = path.join(fixture.project, ".agents", "skills", "withdrawn", "SKILL.md");
  fs.mkdirSync(state, { recursive: true });
  fs.mkdirSync(path.dirname(skill), { recursive: true });
  fs.writeFileSync(skill, "Withdrawn skill.\n");
  fs.writeFileSync(path.join(state, "manifest.json"), `${JSON.stringify({
    manifestVersion: 2,
    adapters: [],
    components: [{ id: "skill/withdrawn", scope: "project" }],
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(state, "lock.json"), `${JSON.stringify({
    lockfileVersion: 1,
    components: {
      "skill/withdrawn": {
        kind: "skill",
        scope: "project",
        files: [{ path: "./.agents/skills/withdrawn/SKILL.md", kind: "file", created: true }],
      },
    },
  }, null, 2)}\n`);

  const removed = run(fixture, "remove", "skill/withdrawn");
  assert.equal(removed.status, 0, removed.stderr);
  assert.equal(fs.existsSync(skill), false);
  assert.deepEqual(JSON.parse(read(fixture.project, ".agent-suitup/manifest.json")).components, []);
});

test("installs App Meerkat guidance as compact blocks", (context) => {
  const fixture = makeFixture(context);
  const blockIds = [
    "block/completion-evidence",
    "block/transparent-shortcuts",
    "block/secure-defaults",
    "block/no-unfinished-ui",
  ];
  const ids = blockIds;
  fs.writeFileSync(path.join(fixture.project, "AGENTS.md"), "# Existing guidance\n");

  const installed = run(fixture, "add", ...ids);
  assert.equal(installed.status, 0, installed.stderr);
  assert.match(read(fixture.project, "AGENTS.md"), /# Existing guidance/);
  const rules = read(fixture.project, ".agents/rules.md");
  for (const id of blockIds) assert.equal(count(rules, `<!--as:${id}-->`), 1, id);

  const lock = JSON.parse(read(fixture.project, ".agent-suitup/lock.json"));
  for (const id of ids) {
    assert.equal(lock.components[id].source.upstream, "jmlero/app-meerkat");
    assert.match(lock.components[id].source.revision, /^[0-9a-f]{40}$/);
  }
  assert.match(run(fixture, "doctor").stdout, /Healthy.*4 components/);
  assert.match(run(fixture, "add", ...ids).stdout, /^No file changes\./);

  const removed = run(fixture, "remove", ...ids);
  assert.equal(removed.status, 0, removed.stderr);
  assert.equal(read(fixture.project, "AGENTS.md"), "# Existing guidance\n");
});

test("sectioned catalog exposes commands as complete portable skills", (context) => {
  const fixture = makeFixture(context);
  const listed = run(fixture, "list");
  assert.equal(listed.status, 0, listed.stderr);
  for (const section of [
    "Blocks \\(9\\)",
    "Skills \\(3\\)",
    "Skill commands \\(1\\)",
    "Integrations \\(5\\)",
  ]) assert.match(listed.stdout, new RegExp(section));
  assert.doesNotMatch(listed.stdout, /External tools|Hooks & automation/);
  const blocks = run(fixture, "list", "blocks");
  assert.match(blocks.stdout, /block\/tdd[\s\S]*72 words/);
  assert.match(blocks.stdout, /block\/ponytail[\s\S]*67 words/);

  const commands = run(fixture, "list", "commands");
  assert.equal(commands.status, 0, commands.stderr);
  assert.match(commands.stdout, /command\/commit-work/);
  assert.doesNotMatch(commands.stdout, /block\/tdd/);

  const preview = run(fixture, "add", "command/commit-work", "--dry-run");
  assert.equal(preview.status, 0, preview.stderr);
  assert.match(preview.stdout, /# Commit Work/);
  assert.match(preview.stdout, /Dry run complete/);
  assert.equal(fs.existsSync(path.join(fixture.project, ".agent-suitup")), false);

  const installed = run(fixture, "add", "command/commit-work");
  assert.equal(installed.status, 0, installed.stderr);
  assert.match(installed.stdout, /Selected[\s\S]*Skill commands\s+Commit work/);
  // Without --agent, a new project sets up every agent.
  assert.match(installed.stdout, /Files\n│ \+6 new/);
  assert.match(installed.stdout, /Run\s+\/commit-work in Claude Code or Grok Build, \$commit-work in Codex\n/);
  assert.deepEqual(JSON.parse(read(fixture.project, ".agent-suitup/manifest.json")).adapters, ["claude", "codex", "grok"]);
  for (const agent of ["claude", "grok"]) {
    assert.match(read(fixture.project, `.${agent}/skills/commit-work/SKILL.md`), /disable-model-invocation: true/);
  }
  const grokOnly = run(makeFixture(context), "add", "command/commit-work", "--agent", "grok");
  assert.match(grokOnly.stdout, /Run\s+\/commit-work in Grok Build\n/);
  assert.doesNotMatch(installed.stdout, /# Commit Work/);
  for (const name of ["commit-work"]) {
    assert.match(read(fixture.project, `.agents/skills/${name}/SKILL.md`), new RegExp(`name: ${name}`));
    assert.match(read(fixture.project, `.agents/skills/${name}/agents/openai.yaml`), /allow_implicit_invocation: false/);
  }
  assert.match(run(fixture, "doctor").stdout, /Healthy.*1 component/);

  const removed = run(fixture, "remove", "command/commit-work");
  assert.equal(removed.status, 0, removed.stderr);
  assert.equal(fs.existsSync(path.join(fixture.project, ".agents", "skills", "commit-work", "SKILL.md")), false);
});

test("Claude adapter exposes canonical blocks and skills without duplicating them", (context) => {
  const fixture = makeFixture(context);
  fs.writeFileSync(path.join(fixture.project, "CLAUDE.md"), "# Claude notes\n");

  const installed = run(fixture, "add", "block/tdd", "skill/audit-docs", "--adapter", "claude");
  assert.equal(installed.status, 0, installed.stderr);
  assert.equal(read(fixture.project, "CLAUDE.md"), "# Claude notes\n");
  // Claude Code skips AGENTS.md when CLAUDE.md exists, so the rules would not load.
  assert.match(installed.stdout, /Manual steps \(not executed\)[\s\S]*Claude Code reads CLAUDE\.md instead of AGENTS\.md, so it skips \.agents\/rules\.md; add a line with @AGENTS\.md to CLAUDE\.md/);
  assert.match(run(fixture, "doctor").stdout, /Healthy[\s\S]*add a line with @AGENTS\.md/);
  fs.writeFileSync(path.join(fixture.project, "CLAUDE.md"), "@AGENTS.md\n\n# Claude notes\n");
  assert.doesNotMatch(run(fixture, "doctor").stdout, /Manual steps/);
  fs.writeFileSync(path.join(fixture.project, "CLAUDE.md"), "# Claude notes\n");
  if (process.platform !== "win32") {
    assert.equal(fs.lstatSync(path.join(fixture.project, ".claude", "skills", "audit-docs")).isSymbolicLink(), true);
  }

  const disabled = run(fixture, "remove", "--adapter", "claude");
  assert.equal(disabled.status, 0, disabled.stderr);
  assert.equal(read(fixture.project, "CLAUDE.md"), "# Claude notes\n");
  assert.equal(fs.existsSync(path.join(fixture.project, ".claude", "skills", "audit-docs")), false);
  assert.ok(fs.existsSync(path.join(fixture.project, ".agents", "skills", "audit-docs", "SKILL.md")));
});

test("Claude reads AGENTS.md directly and never gets a CLAUDE.md", { skip: process.platform === "win32" }, (context) => {
  const fixture = makeFixture(context);
  const installed = run(fixture, "add", "block/tdd", "--adapter", "claude");
  assert.equal(installed.status, 0, installed.stderr);
  assert.match(read(fixture.project, "AGENTS.md"), /^Project rules: read and follow @\.agents\/rules\.md before/m);
  assert.equal(fs.existsSync(path.join(fixture.project, "CLAUDE.md")), false);
  assert.equal(Object.hasOwn(JSON.parse(read(fixture.project, ".agent-suitup/lock.json")), "bridges"), false);

  // A bridge recorded by an earlier lockfile is forgotten, not repaired or deleted.
  const lockFile = path.join(fixture.project, ".agent-suitup", "lock.json");
  const lock = JSON.parse(fs.readFileSync(lockFile, "utf8"));
  lock.bridges = { claudeAgents: { path: "./CLAUDE.md", managed: "symlink", target: "AGENTS.md", owned: true } };
  fs.writeFileSync(lockFile, `${JSON.stringify(lock, null, 2)}\n`);
  fs.symlinkSync("AGENTS.md", path.join(fixture.project, "CLAUDE.md"));
  const stale = run(fixture, "doctor");
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /No file changes\.\nLockfile metadata differs/);
  assert.equal(run(fixture, "update").status, 0);
  assert.equal(Object.hasOwn(JSON.parse(read(fixture.project, ".agent-suitup/lock.json")), "bridges"), false);
  assert.match(run(fixture, "doctor").stdout, /Healthy/);

  const removed = run(fixture, "remove", "block/tdd");
  assert.equal(removed.status, 0, removed.stderr);
  assert.equal(fs.readlinkSync(path.join(fixture.project, "CLAUDE.md")), "AGENTS.md");
});

test("cleanup refuses a user skill bridge that changed type when removing or disabling Claude", { skip: process.platform === "win32" }, (context) => {
  const fixture = makeFixture(context);
  assert.equal(run(fixture, "add", "skill/audit-docs", "--scope", "user", "--adapter", "claude").status, 0);
  const canonical = read(fixture.home, ".agents/skills/audit-docs/SKILL.md");
  const bridge = path.join(fixture.home, ".claude", "skills", "audit-docs");
  fs.unlinkSync(bridge);
  fs.writeFileSync(bridge, "User-authored replacement.\n");
  const before = snapshotTree(fixture.root);

  for (const arguments_ of [
    ["remove", "skill/audit-docs"],
    ["remove", "--adapter", "claude"],
  ]) {
    const refused = run(fixture, ...arguments_);
    assert.equal(refused.status, 1, refused.stdout);
    assert.match(refused.stderr, /changed type.*audit-docs/i);
    assert.deepEqual(snapshotTree(fixture.root), before);
  }

  const disabled = run(fixture, "remove", "--adapter", "claude", "--force");
  assert.equal(disabled.status, 0, disabled.stderr);
  assert.equal(fs.existsSync(bridge), false);
  assert.equal(read(fixture.home, ".agents/skills/audit-docs/SKILL.md"), canonical);
  assert.match(run(fixture, "doctor").stdout, /Healthy/);
});

test("cleanup refuses a skill file that changed type during removal or scope migration", { skip: process.platform === "win32" }, (context) => {
  const fixture = makeFixture(context);
  assert.equal(run(fixture, "add", "skill/audit-docs").status, 0);
  const skill = path.join(fixture.project, ".agents", "skills", "audit-docs", "SKILL.md");
  const target = path.join(fixture.home, "custom-skill.md");
  fs.writeFileSync(target, "User-authored skill.\n");
  fs.unlinkSync(skill);
  fs.symlinkSync(target, skill);
  const before = snapshotTree(fixture.root);

  for (const arguments_ of [
    ["remove", "skill/audit-docs"],
    ["add", "skill/audit-docs", "--scope", "user"],
  ]) {
    const refused = run(fixture, ...arguments_);
    assert.equal(refused.status, 1, refused.stdout);
    assert.match(refused.stderr, /changed type.*SKILL\.md/i);
    assert.deepEqual(snapshotTree(fixture.root), before);
  }

  const removed = run(fixture, "remove", "skill/audit-docs", "--force");
  assert.equal(removed.status, 0, removed.stderr);
  assert.throws(() => fs.lstatSync(skill), { code: "ENOENT" });
  assert.deepEqual(snapshotTree(fixture.home), before.home.entries);
  assert.match(run(fixture, "doctor").stdout, /Healthy/);
});

test("cleanup preserves a replacement directory even when force is explicit", (context) => {
  const fixture = makeFixture(context);
  assert.equal(run(fixture, "add", "skill/audit-docs").status, 0);
  const skill = path.join(fixture.project, ".agents", "skills", "audit-docs", "SKILL.md");
  fs.unlinkSync(skill);
  fs.mkdirSync(skill);
  fs.writeFileSync(path.join(skill, "notes.md"), "Keep these notes.\n");
  const before = snapshotTree(fixture.root);

  for (const flags of [[], ["--force"]]) {
    const refused = run(fixture, "remove", "skill/audit-docs", ...flags);
    assert.equal(refused.status, 1, refused.stdout);
    assert.match(refused.stderr, /Refusing to delete directory/);
    assert.deepEqual(snapshotTree(fixture.root), before);
  }
});

test("detects drift and refuses destructive removal unless forced", (context) => {
  const fixture = makeFixture(context);
  const installed = run(fixture, "add", "skill/audit-docs");
  assert.equal(installed.status, 0, installed.stderr);
  const skill = path.join(fixture.project, ".agents", "skills", "audit-docs", "SKILL.md");
  fs.appendFileSync(skill, "\nLocal edit.\n");

  const doctor = run(fixture, "doctor");
  assert.equal(doctor.status, 1);
  assert.match(doctor.stderr, /local changes/i);
  const refused = run(fixture, "remove", "skill/audit-docs");
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /local changes/i);
  assert.ok(fs.existsSync(skill));

  const forced = run(fixture, "remove", "skill/audit-docs", "--force");
  assert.equal(forced.status, 0, forced.stderr);
  assert.equal(fs.existsSync(skill), false);
});

test("group-writable checkouts are not drift and keep their permissions", { skip: process.platform === "win32" }, (context) => {
  const fixture = makeFixture(context);
  const installed = run(fixture, "add", "block/tdd", "skill/audit-docs");
  assert.equal(installed.status, 0, installed.stderr);
  const files = ["AGENTS.md", ".agents/rules.md", ".agents/skills/audit-docs/SKILL.md", ".agent-suitup/lock.json"]
    .map((file) => path.join(fixture.project, file));
  for (const file of files) fs.chmodSync(file, 0o664);

  const doctor = run(fixture, "doctor");
  assert.equal(doctor.status, 0, doctor.stderr);
  assert.match(doctor.stdout, /Healthy/);
  const added = run(fixture, "add", "block/focused-changes");
  assert.equal(added.status, 0, added.stderr);
  for (const file of files) assert.equal(fs.statSync(file).mode & 0o777, 0o664, file);
});

test("removal keeps adopted files that existed before installation", (context) => {
  const fixture = makeFixture(context);
  const adopted = path.join(fixture.home, ".agents", "skills", "audit-docs", "SKILL.md");
  const canonical = read(repository, "catalog/skills/audit-docs/SKILL.md");
  fs.mkdirSync(path.dirname(adopted), { recursive: true });
  fs.writeFileSync(adopted, `${canonical.replace(/\r\n/g, "\n").trimEnd()}\n`);
  const installed = run(fixture, "add", "skill/audit-docs", "command/commit-work", "--scope", "user");
  assert.equal(installed.status, 0, installed.stderr);
  const created = path.join(fixture.home, ".agents", "skills", "commit-work", "SKILL.md");
  assert.ok(fs.existsSync(created));

  const removed = run(fixture, "remove", "skill/audit-docs", "command/commit-work");
  assert.equal(removed.status, 0, removed.stderr);
  assert.ok(fs.existsSync(adopted), "a file that existed before installation was deleted");
  assert.equal(fs.existsSync(created), false);
  assert.match(removed.stdout, /~\/\.agents\/skills\/audit-docs\/SKILL\.md: kept because it existed before installation/);
});

test("Claude marketplace edits preserve unrelated settings", (context) => {
  const fixture = makeFixture(context);
  fs.mkdirSync(path.join(fixture.project, ".claude"), { recursive: true });
  fs.mkdirSync(path.join(fixture.home, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(fixture.project, ".claude", "settings.json"), '{"permissions":{"allow":["Read"]}}\n');
  fs.writeFileSync(path.join(fixture.home, ".claude", "settings.json"), '{"theme":"dark"}\n');

  const installed = run(fixture, "add", "plugin/github");
  assert.equal(installed.status, 0, installed.stderr);
  assert.deepEqual(JSON.parse(read(fixture.project, ".agent-suitup/manifest.json")).adapters, ["claude", "codex", "grok"]);
  const projectSettings = JSON.parse(read(fixture.project, ".claude/settings.json"));
  assert.deepEqual(projectSettings.permissions, { allow: ["Read"] });
  assert.equal(projectSettings.enabledPlugins["github@claude-plugins-official"], true);
  assert.equal(projectSettings.extraKnownMarketplaces["claude-plugins-official"].source.repo, "anthropics/claude-plugins-official");
  assert.equal(read(fixture.home, ".claude/settings.json"), '{"theme":"dark"}\n', "a project plugin changed user settings");

  const removed = run(fixture, "remove", "plugin/github");
  assert.equal(removed.status, 0, removed.stderr);
  assert.deepEqual(JSON.parse(read(fixture.project, ".claude/settings.json")), { permissions: { allow: ["Read"] } });
  assert.equal(read(fixture.home, ".claude/settings.json"), '{"theme":"dark"}\n');
});

test("a marketplace agent-suitup registered stays until its last plugin is removed", (context) => {
  const fixture = makeFixture(context);
  const installed = run(fixture, "add", "plugin/github", "plugin/frontend-design");
  assert.equal(installed.status, 0, installed.stderr);
  const settings = () => JSON.parse(read(fixture.project, ".claude/settings.json"));
  const lock = JSON.parse(read(fixture.project, ".agent-suitup/lock.json"));
  assert.equal(lock.components["plugin/github"].marketplaceCreated, true);
  assert.equal(lock.components["plugin/frontend-design"].marketplaceCreated, true);

  assert.equal(run(fixture, "remove", "plugin/github").status, 0);
  assert.ok(settings().extraKnownMarketplaces["claude-plugins-official"], "a marketplace still in use was removed");
  assert.match(run(fixture, "doctor").stdout, /Healthy/);

  assert.equal(run(fixture, "remove", "plugin/frontend-design").status, 0);
  assert.deepEqual(settings(), {});
  assert.equal(fs.existsSync(path.join(fixture.home, ".claude")), false);
});

test("a marketplace the user registered is kept when plugins are removed or change scope", (context) => {
  const fixture = makeFixture(context);
  const marketplace = { source: { source: "github", repo: "anthropics/claude-plugins-official" } };
  fs.mkdirSync(path.join(fixture.project, ".claude"));
  fs.writeFileSync(path.join(fixture.project, ".claude", "settings.json"),
    `${JSON.stringify({ extraKnownMarketplaces: { "claude-plugins-official": marketplace } })}\n`);

  const installed = run(fixture, "add", "plugin/github");
  assert.equal(installed.status, 0, installed.stderr);
  assert.equal(Object.hasOwn(JSON.parse(read(fixture.project, ".agent-suitup/lock.json"))
    .components["plugin/github"], "marketplaceCreated"), false);

  const moved = run(fixture, "add", "plugin/github", "--scope", "user");
  assert.equal(moved.status, 0, moved.stderr);
  assert.deepEqual(JSON.parse(read(fixture.project, ".claude/settings.json")),
    { extraKnownMarketplaces: { "claude-plugins-official": marketplace } });
  const user = JSON.parse(read(fixture.home, ".claude/settings.json"));
  assert.deepEqual(user.extraKnownMarketplaces["claude-plugins-official"], marketplace);
  assert.equal(user.enabledPlugins["github@claude-plugins-official"], true);

  assert.equal(run(fixture, "remove", "plugin/github").status, 0);
  assert.deepEqual(JSON.parse(read(fixture.home, ".claude/settings.json")), {});
  assert.deepEqual(JSON.parse(read(fixture.project, ".claude/settings.json")),
    { extraKnownMarketplaces: { "claude-plugins-official": marketplace } });
});

test("plugin prerequisites are checked before Claude settings are changed", { skip: process.platform === "win32" }, (context) => {
  const fixture = makeFixture(context);
  const emptyPath = path.join(fixture.root, "empty-bin");
  fs.mkdirSync(emptyPath);
  const missing = runWithEnv(fixture, { PATH: emptyPath }, "add", "plugin/typescript-lsp");
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /requires commands that are not available: typescript-language-server/);
  assert.equal(fs.existsSync(path.join(fixture.project, ".claude")), false);

  const executable = path.join(emptyPath, "typescript-language-server");
  fs.writeFileSync(executable, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const installed = runWithEnv(fixture, { PATH: emptyPath }, "add", "plugin/typescript-lsp");
  assert.equal(installed.status, 0, installed.stderr);
  assert.deepEqual(JSON.parse(read(fixture.project, ".agent-suitup/manifest.json")).components,
    [{ id: "plugin/typescript-lsp", scope: "user" }]);
  const settings = JSON.parse(read(fixture.home, ".claude/settings.json"));
  assert.equal(settings.extraKnownMarketplaces["claude-plugins-official"].source.repo, "anthropics/claude-plugins-official");
});

test("an installed integration missing its executable is reported without blocking other work", { skip: process.platform === "win32" }, (context) => {
  const fixture = makeFixture(context);
  const executables = path.join(fixture.root, "bin");
  fs.mkdirSync(executables);
  const executable = path.join(executables, "typescript-language-server");
  fs.writeFileSync(executable, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const installed = runWithEnv(fixture, { PATH: executables }, "add", "plugin/typescript-lsp");
  assert.equal(installed.status, 0, installed.stderr);
  fs.unlinkSync(executable);

  const doctor = runWithEnv(fixture, { PATH: executables }, "doctor");
  assert.equal(doctor.status, 1);
  assert.doesNotMatch(doctor.stdout, /Healthy/);
  assert.match(doctor.stderr, /plugin\/typescript-lsp: install typescript-language-server/);

  const added = runWithEnv(fixture, { PATH: executables }, "add", "block/tdd");
  assert.equal(added.status, 0, added.stderr);
  assert.match(added.stdout, /plugin\/typescript-lsp: install typescript-language-server/);
  assert.ok(fs.existsSync(path.join(fixture.project, "AGENTS.md")));
  const planned = runWithEnv(fixture, { PATH: executables }, "plan");
  assert.equal(planned.status, 0, planned.stderr);

  const refused = runWithEnv(fixture, { PATH: executables }, "add", "plugin/pyright-lsp");
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /requires commands that are not available: pyright-langserver/);
});

test("an interactive scope choice takes precedence over a plugin recommendation", (context) => {
  const fixture = makeFixture(context);
  const executableDirectory = path.join(fixture.root, "bin");
  fs.mkdirSync(executableDirectory);
  fs.writeFileSync(path.join(executableDirectory, "typescript-language-server"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const result = spawnSync(process.execPath, [cli, "init", "--interactive"], {
    cwd: fixture.project,
    env: { ...process.env, HOME: fixture.home, USERPROFILE: fixture.home, PATH: executableDirectory },
    encoding: "utf8", input: "claude\nplugin/typescript-lsp\ny\n", timeout: 5_000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Install for\s+this project\n[\s\S]*Integrations \(1\)\s+TypeScript LSP\n/);
  assert.deepEqual(JSON.parse(read(fixture.project, ".agent-suitup/manifest.json")).components,
    [{ id: "plugin/typescript-lsp", scope: "project" }]);
  assert.equal(JSON.parse(read(fixture.project, ".claude/settings.json"))
    .enabledPlugins["typescript-lsp@claude-plugins-official"], true);
});

test("Grok adapter makes portable commands slash-only without copying their workflow", (context) => {
  const fixture = makeFixture(context);
  const installed = run(fixture, "add", "command/commit-work", "--adapter", "grok");
  assert.equal(installed.status, 0, installed.stderr);

  const canonical = read(fixture.project, ".agents/skills/commit-work/SKILL.md");
  assert.doesNotMatch(canonical, /disable-model-invocation/);
  const bridge = read(fixture.project, ".grok/skills/commit-work/SKILL.md");
  assert.match(bridge, /disable-model-invocation: true/);
  assert.match(bridge, /\.\.\/\.\.\/\.\.\/\.agents\/skills\/commit-work\/SKILL\.md/);
  assert.doesNotMatch(bridge, /Discover validation commands/);
  assert.match(run(fixture, "doctor").stdout, /Healthy.*1 component/);

  const portable = run(fixture, "remove", "--adapter", "grok");
  assert.equal(portable.status, 0, portable.stderr);
  assert.equal(fs.existsSync(path.join(fixture.project, ".grok", "skills", "commit-work", "SKILL.md")), false);
  assert.ok(fs.existsSync(path.join(fixture.project, ".agents", "skills", "commit-work", "SKILL.md")));
});

test("Claude adapter makes portable commands slash-only without copying their workflow", (context) => {
  const fixture = makeFixture(context);
  const installed = run(fixture, "add", "command/commit-work", "--adapter", "claude");
  assert.equal(installed.status, 0, installed.stderr);

  const wrapper = path.join(fixture.project, ".claude", "skills", "commit-work");
  assert.equal(fs.lstatSync(wrapper).isDirectory(), true);
  assert.deepEqual(fs.readdirSync(wrapper), ["SKILL.md"]);
  const bridge = read(fixture.project, ".claude/skills/commit-work/SKILL.md");
  assert.match(bridge, /disable-model-invocation: true/);
  assert.match(bridge, /\.\.\/\.\.\/\.\.\/\.agents\/skills\/commit-work\/SKILL\.md/);
  assert.doesNotMatch(bridge, /# Commit Work/);
  assert.match(run(fixture, "doctor").stdout, /Healthy.*1 component/);

  const portable = run(fixture, "remove", "--adapter", "claude");
  assert.equal(portable.status, 0, portable.stderr);
  assert.equal(fs.existsSync(path.join(wrapper, "SKILL.md")), false);
  assert.ok(fs.existsSync(path.join(fixture.project, ".agents", "skills", "commit-work", "SKILL.md")));
});

test("Claude command wrappers replace the folder links of earlier installs", {
  skip: process.platform === "win32",
}, (context) => {
  const fixture = makeFixture(context);
  assert.equal(run(fixture, "add", "command/commit-work", "--adapter", "claude").status, 0);

  // Recreate the earlier layout, which linked the canonical folder into Claude.
  const directory = path.join(fixture.project, ".claude", "skills", "commit-work");
  fs.rmSync(directory, { recursive: true });
  fs.symlinkSync("../../.agents/skills/commit-work", directory, "dir");
  const lockFile = path.join(fixture.project, ".agent-suitup", "lock.json");
  const lock = JSON.parse(fs.readFileSync(lockFile, "utf8"));
  const entry = lock.components["command/commit-work"];
  entry.files = entry.files.filter(({ claudeCommandBridge }) => !claudeCommandBridge);
  entry.files.push({ path: "./.claude/skills/commit-work", kind: "symlink", target: "../../.agents/skills/commit-work", created: true });
  fs.writeFileSync(lockFile, `${JSON.stringify(lock, null, 2)}\n`);
  const canonical = read(fixture.project, ".agents/skills/commit-work/SKILL.md");

  const drift = run(fixture, "doctor");
  assert.equal(drift.status, 1);
  assert.match(drift.stderr, /DELETE \.\/\.claude\/skills\/commit-work -> \.\.\/\.\.\/\.agents\/skills\/commit-work/);
  assert.match(drift.stderr, /CREATE \.\/\.claude\/skills\/commit-work\/SKILL\.md/);

  const updated = run(fixture, "update");
  assert.equal(updated.status, 0, updated.stderr);
  assert.equal(fs.lstatSync(directory).isDirectory(), true);
  assert.match(read(fixture.project, ".claude/skills/commit-work/SKILL.md"), /disable-model-invocation: true/);
  assert.equal(read(fixture.project, ".agents/skills/commit-work/SKILL.md"), canonical);
  assert.match(run(fixture, "doctor").stdout, /Healthy.*1 component/);
});

test("Claude command wrappers never write through a user's linked folder", {
  skip: process.platform === "win32",
}, (context) => {
  const fixture = makeFixture(context);
  const userSkill = path.join(fixture.root, "my-commit-work");
  fs.mkdirSync(userSkill);
  fs.writeFileSync(path.join(userSkill, "SKILL.md"), "My workflow.\n");
  const directory = path.join(fixture.project, ".claude", "skills", "commit-work");
  fs.mkdirSync(path.dirname(directory), { recursive: true });
  fs.symlinkSync(userSkill, directory, "dir");

  const refused = run(fixture, "add", "command/commit-work", "--adapter", "claude");
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /Refusing to remove unmanaged \.\/\.claude\/skills\/commit-work/);
  assert.equal(fs.lstatSync(directory).isSymbolicLink(), true);

  const forced = run(fixture, "add", "command/commit-work", "--adapter", "claude", "--force");
  assert.equal(forced.status, 0, forced.stderr);
  assert.equal(fs.lstatSync(directory).isDirectory(), true);
  assert.equal(fs.readFileSync(path.join(userSkill, "SKILL.md"), "utf8"), "My workflow.\n");
});

test("adapter flags on add only add adapters", (context) => {
  const fixture = makeFixture(context);
  assert.equal(run(fixture, "add", "command/commit-work", "--adapter", "claude").status, 0);
  const claudeWrapper = path.join(fixture.project, ".claude", "skills", "commit-work", "SKILL.md");

  const added = run(fixture, "add", "block/tdd", "--adapter", "grok");
  assert.equal(added.status, 0, added.stderr);
  assert.deepEqual(JSON.parse(read(fixture.project, ".agent-suitup/manifest.json")).adapters, ["claude", "grok"]);
  assert.ok(fs.existsSync(claudeWrapper), "adding an adapter removed another adapter's files");
  assert.ok(fs.existsSync(path.join(fixture.project, ".grok", "skills", "commit-work", "SKILL.md")));

  const unchanged = snapshotTree(fixture.root);
  assert.equal(run(fixture, "add", "block/tdd", "--adapter", "none").status, 0);
  assert.deepEqual(snapshotTree(fixture.root), unchanged);

  const initialized = spawnSync(process.execPath, [cli, "init", "--interactive", "--adapter", "grok"], {
    cwd: fixture.project,
    env: { ...process.env, HOME: fixture.home, USERPROFILE: fixture.home, NO_COLOR: "1" },
    encoding: "utf8", input: "skill/audit-docs\nproject\ny\n", timeout: 5_000,
  });
  assert.equal(initialized.status, 0, initialized.stderr);
  assert.deepEqual(JSON.parse(read(fixture.project, ".agent-suitup/manifest.json")).adapters, ["claude", "grok"]);
});

test("remove --adapter drops only that adapter's files", (context) => {
  const fixture = makeFixture(context);
  const added = run(fixture, "add", "block/tdd", "command/commit-work", "--adapters=claude,grok");
  assert.equal(added.status, 0, added.stderr);
  assert.ok(fs.existsSync(path.join(fixture.project, ".claude", "skills", "commit-work", "SKILL.md")));

  const preview = run(fixture, "remove", "--adapter", "claude", "--dry-run");
  assert.equal(preview.status, 0, preview.stderr);
  assert.match(preview.stdout, /DELETE \.\/\.claude\/skills\/commit-work\/SKILL\.md/);
  assert.ok(fs.existsSync(path.join(fixture.project, ".claude", "skills", "commit-work", "SKILL.md")));

  const dropped = run(fixture, "remove", "--adapter", "claude");
  assert.equal(dropped.status, 0, dropped.stderr);
  assert.match(dropped.stdout, /Agents removed · 3 file changes/);
  assert.deepEqual(JSON.parse(read(fixture.project, ".agent-suitup/manifest.json")).adapters, ["grok"]);
  assert.equal(fs.existsSync(path.join(fixture.project, ".claude", "skills", "commit-work")), false);
  assert.ok(fs.existsSync(path.join(fixture.project, ".grok", "skills", "commit-work", "SKILL.md")));
  assert.ok(fs.existsSync(path.join(fixture.project, ".agents", "skills", "commit-work", "SKILL.md")));
  assert.match(read(fixture.project, ".agents/rules.md"), /<!--as:block\/tdd-->/);
  assert.match(run(fixture, "doctor").stdout, /Healthy/);
});

test("remove --adapter refuses adapters that are disabled or still required", (context) => {
  const fixture = makeFixture(context);
  assert.equal(run(fixture, "add", "plugin/github", "block/tdd", "--agent", "claude").status, 0);
  const before = snapshotTree(fixture.root);

  for (const [adapter, message] of [
    ["grok", /Agent not set up: grok/],
    ["none", /remove --agent needs claude, codex, grok/],
    ["claude", /plugin\/github still requires Claude Code; remove it first or in the same command/],
  ]) {
    const refused = run(fixture, "remove", "--adapter", adapter);
    assert.equal(refused.status, 1, refused.stdout);
    assert.match(refused.stderr, message);
    assert.deepEqual(snapshotTree(fixture.root), before);
  }

  const together = run(fixture, "remove", "plugin/github", "--adapter", "claude");
  assert.equal(together.status, 0, together.stderr);
  const manifest = JSON.parse(read(fixture.project, ".agent-suitup/manifest.json"));
  assert.deepEqual(manifest.adapters, []);
  assert.deepEqual(manifest.components.map(({ id }) => id), ["block/tdd"]);
});

test("help lists category keys, agent values, file locations, and command invocation", (context) => {
  const fixture = makeFixture(context);
  const help = run(fixture, "--help");
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Tab, Shift\+Tab, ←\/→, or 1-5 switch\s+categories/);
  assert.match(help.stdout, /--agent VALUE\s+Coding agents: claude, codex, grok, a comma-separated list,\s+or none \(alias --adapter\)/);
  assert.match(help.stdout, /agent-suitup remove --agent claude\|codex\|grok/);
  assert.match(help.stdout, /blocks\s+\.agents\/rules\.md, linked from AGENTS\.md/);
  assert.match(help.stdout, /\/name in Claude Code and\s+Grok Build, \$name in Codex/);
});

test("--agent is accepted everywhere --adapter was, including codex", (context) => {
  const fixture = makeFixture(context);
  const added = run(fixture, "add", "skill/audit-docs", "--agent", "codex");
  assert.equal(added.status, 0, added.stderr);
  assert.deepEqual(JSON.parse(read(fixture.project, ".agent-suitup/manifest.json")).adapters, ["codex"]);
  assert.equal(fs.existsSync(path.join(fixture.project, ".claude")), false, "Codex reads .agents/skills directly");
  assert.equal(run(fixture, "add", "block/tdd").status, 0);
  assert.deepEqual(JSON.parse(read(fixture.project, ".agent-suitup/manifest.json")).adapters, ["codex"],
    "an existing project keeps the agents it chose");
  assert.equal(run(fixture, "add", "skill/audit-docs", "--agents=claude,grok").status, 0);
  assert.deepEqual(JSON.parse(read(fixture.project, ".agent-suitup/manifest.json")).adapters, ["claude", "codex", "grok"]);
  const dropped = run(fixture, "remove", "--agent", "codex");
  assert.equal(dropped.status, 0, dropped.stderr);
  assert.deepEqual(JSON.parse(read(fixture.project, ".agent-suitup/manifest.json")).adapters, ["claude", "grok"]);
  const invalid = run(fixture, "add", "skill/audit-docs", "--agent", "cursor");
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /Invalid agents: cursor/);
});

test("version and help report the package version", (context) => {
  const fixture = makeFixture(context);
  const { version } = JSON.parse(read(repository, "package.json"));
  const printed = run(fixture, "--version");
  assert.equal(printed.status, 0, printed.stderr);
  assert.equal(printed.stdout, `${version}\n`);
  assert.match(run(fixture, "--help").stdout, new RegExp(`^agent-suitup ${version.replaceAll(".", "\\.")}\n`));
});

test("doctor agrees in number with the component count", (context) => {
  const fixture = makeFixture(context);
  assert.equal(run(fixture, "add", "block/tdd").status, 0);
  assert.match(run(fixture, "doctor").stdout, /Healthy · 1 component matches the manifest and lockfile\./);
  assert.equal(run(fixture, "add", "skill/audit-docs").status, 0);
  assert.match(run(fixture, "doctor").stdout, /Healthy · 2 components match the manifest and lockfile\./);
});

test("removal deletes skill directories it emptied and keeps directories with other files", (context) => {
  const fixture = makeFixture(context);
  const added = run(fixture, "add", "command/commit-work", "skill/audit-docs", "--adapter", "grok");
  assert.equal(added.status, 0, added.stderr);
  const skills = path.join(fixture.project, ".agents", "skills");
  fs.writeFileSync(path.join(skills, "audit-docs", "notes.md"), "My notes.\n");

  const removed = run(fixture, "remove", "command/commit-work", "skill/audit-docs");
  assert.equal(removed.status, 0, removed.stderr);
  assert.equal(fs.existsSync(path.join(skills, "commit-work")), false, "an emptied skill directory remains");
  assert.equal(fs.existsSync(path.join(fixture.project, ".grok", "skills", "commit-work")), false);
  assert.ok(fs.existsSync(path.join(fixture.project, ".grok", "skills")), "the agent's skills folder is kept");
  assert.deepEqual(fs.readdirSync(skills), ["audit-docs"]);
  assert.deepEqual(fs.readdirSync(path.join(skills, "audit-docs")), ["notes.md"]);
});

test("adapter-specific components reject an explicitly disabled adapter", (context) => {
  const fixture = makeFixture(context);
  const result = run(fixture, "add", "plugin/github", "--adapter", "none");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /plugin\/github requires Claude Code \(--agent claude\)/);
  assert.equal(fs.existsSync(path.join(fixture.project, ".agent-suitup")), false);
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

function makeFixture(context) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-suitup-cli-"));
  const project = path.join(root, "project");
  const home = path.join(root, "home");
  fs.mkdirSync(project);
  fs.mkdirSync(home);
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, project, home };
}

function run(fixture, ...arguments_) {
  return runWithEnv(fixture, {}, ...arguments_);
}

function runWithEnv(fixture, environment, ...arguments_) {
  return spawnSync(process.execPath, [cli, ...arguments_], {
    cwd: fixture.project,
    encoding: "utf8",
    env: { ...process.env, HOME: fixture.home, USERPROFILE: fixture.home, ...environment },
  });
}

function runInteractive(fixture, steps, ...arguments_) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...arguments_], {
      cwd: fixture.project,
      env: { ...process.env, HOME: fixture.home, USERPROFILE: fixture.home },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let step = 0;
    let searchOffset = 0;
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`Interactive CLI timed out after step ${step}:\n${stdout}\n${stderr}`));
    }, 5_000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (step >= steps.length) return;
      const [pattern, answer] = steps[step];
      if (!pattern.test(stdout.slice(searchOffset))) return;
      searchOffset = stdout.length;
      step += 1;
      try {
        child.stdin.write(`${typeof answer === "function" ? answer() : answer}\n`);
      } catch (error) {
        clearTimeout(timeout);
        child.kill();
        reject(error);
      }
      if (step === steps.length) child.stdin.end();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (status) => {
      clearTimeout(timeout);
      if (step !== steps.length) return reject(new Error(`CLI stopped after ${step}/${steps.length} answers:\n${stdout}\n${stderr}`));
      resolve({ status, stdout, stderr });
    });
  });
}

function read(root, relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

function count(value, needle) {
  return value.split(needle).length - 1;
}
