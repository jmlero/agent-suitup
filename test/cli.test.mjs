import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

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
  assert.doesNotMatch(assessed.stdout, /Healthy|Agent Suitup ready|Change set/);
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
    const components = ["block/tdd", "command/verify-work"];
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

test("non-interactive assessment does not migrate legacy manifests or create lockfiles", (context) => {
  const fixture = makeFixture(context);
  fs.mkdirSync(path.join(fixture.project, ".agent-suitup"));
  fs.writeFileSync(path.join(fixture.project, ".agent-suitup", "manifest.json"), JSON.stringify({
    manifestVersion: 1,
    targets: ["codex"],
    components: [{ id: "block/tdd", scope: "project" }],
  }));
  const before = snapshotTree(fixture.root);

  const assessed = run(fixture, "init", "--yes");
  assert.equal(assessed.status, 0, assessed.stderr);
  assert.match(assessed.stdout, /Repository left unchanged/);
  assert.deepEqual(snapshotTree(fixture.root), before);
});

test("interactive init exposes the whole catalog and can install a block without an adapter", async (context) => {
  const fixture = makeFixture(context);
  const initialized = await runInteractive(fixture, [
    [/Select numbers or ranges/, "1"],
    [/Agent setup/, "portable"],
    [/Install this selection/, "y"],
  ], "init", "--interactive");
  assert.equal(initialized.status, 0, initialized.stderr);
  assert.match(initialized.stdout, /Instruction blocks \(8\)/);
  assert.match(initialized.stdout, /inside owned AGENTS\.md markers; existing text is preserved/);
  assert.match(initialized.stdout, /01 · block\/tdd[\s\S]*53 words/);
  assert.match(initialized.stdout, /Agent setup/);
  assert.doesNotMatch(initialized.stdout, /Default scope/);
  assert.match(initialized.stdout, /01 Explore[\s\S]*02 Connect[\s\S]*03 Review/);
  assert.match(initialized.stdout, /Skills \(8\)[\s\S]*Commands \(2\)[\s\S]*Agent integrations \(5\)/);

  const manifest = JSON.parse(read(fixture.project, ".agent-suitup/manifest.json"));
  assert.deepEqual(manifest.adapters, []);
  assert.deepEqual(manifest.components.map(({ id }) => id), ["block/tdd"]);
  assert.match(read(fixture.project, "AGENTS.md"), /<!--as:block\/tdd-->/);
  assert.equal(fs.existsSync(path.join(fixture.project, "CLAUDE.md")), false);
});

test("interactive init confirms the aggregate cost before installing every block", async (context) => {
  const fixture = makeFixture(context);
  const initialized = await runInteractive(fixture, [
    [/Select numbers or ranges/, "1-8"],
    [/Agent setup/, "portable"],
    [/Install this selection/, "y"],
  ], "init", "--interactive");
  assert.equal(initialized.status, 0, initialized.stderr);
  assert.match(initialized.stdout, /Always loaded  411 words · ~712 tokens total/);

  const manifest = JSON.parse(read(fixture.project, ".agent-suitup/manifest.json"));
  assert.equal(manifest.components.length, 8);
  assert.ok(manifest.components.every(({ id }) => id.startsWith("block/")));
  assert.deepEqual(manifest.adapters, []);
});

test("interactive init can browse the whole catalog and skip installation", async (context) => {
  const fixture = makeFixture(context);
  const initialized = await runInteractive(fixture, [
    [/Select numbers or ranges/, "none"],
  ], "init", "--interactive");
  assert.equal(initialized.status, 0, initialized.stderr);
  assert.match(initialized.stdout, /Agent integrations \(5\)/);
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
  assert.doesNotMatch(initialized.stdout, /Healthy|Agent Suitup ready|Change set/);
  assert.deepEqual(snapshotTree(fixture.root), before);
});

test("interactive init preserves local edits when a forced plan is declined", async (context) => {
  const fixture = makeFixture(context);
  const added = run(fixture, "add", "block/tdd", "plugin/github");
  assert.equal(added.status, 0, added.stderr);
  fs.writeFileSync(path.join(fixture.project, "AGENTS.md"), read(fixture.project, "AGENTS.md")
    .replace("For features and bug fixes:", "For parser bug fixes only:"));
  const before = snapshotTree(fixture.root);

  const initialized = await runInteractive(fixture, [
    [/Select numbers or ranges/, "1-8"],
    [/Agent setup/, "portable"],
    [/Install this selection/, "n"],
  ], "init", "--interactive", "--force");
  assert.equal(initialized.status, 0, initialized.stderr);
  assert.match(initialized.stdout, /Installation cancelled. No files written/);
  assert.deepEqual(snapshotTree(fixture.root), before);
});

test("interactive init preserves existing state when the catalog selection is abandoned", async (context) => {
  const fixture = makeFixture(context);
  const added = run(fixture, "add", "block/tdd", "command/verify-work");
  assert.equal(added.status, 0, added.stderr);
  fs.unlinkSync(path.join(fixture.project, ".agents", "skills", "verify-work", "SKILL.md"));
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
  fs.unlinkSync(path.join(fixture.project, "AGENTS.md"));
  const before = snapshotTree(fixture.root);

  const initialized = await runInteractive(fixture, [
    [/Select numbers or ranges/, "1-8"],
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
    [/Select numbers or ranges/, "block/ponytail"],
    [/Agent setup/, "portable"],
    [/Install this selection/, "y"],
  ], "init", "--interactive");
  assert.equal(initialized.status, 0, initialized.stderr);
  const manifest = JSON.parse(read(fixture.project, ".agent-suitup/manifest.json"));
  assert.deepEqual(manifest.components.map(({ id }) => id), ["block/ponytail", "block/tdd"]);
  assert.match(read(fixture.project, "AGENTS.md"), /<!--as:block\/ponytail-->/);
  assert.match(run(fixture, "doctor").stdout, /Healthy.*2 components/);
});

test("interactive init installs a plugin directly from the unified catalog", async (context) => {
  const fixture = makeFixture(context);
  const initialized = await runInteractive(fixture, [
    [/Select numbers or ranges/, "plugin/frontend-design"],
    [/Default scope/, "project"],
    [/Install this selection/, "y"],
  ], "init", "--interactive");
  assert.equal(initialized.status, 0, initialized.stderr);
  assert.match(initialized.stdout, /Agent integrations \(5\)/);
  assert.match(initialized.stdout, /19 · plugin\/frontend-design/);

  const manifest = JSON.parse(read(fixture.project, ".agent-suitup/manifest.json"));
  assert.deepEqual(manifest.adapters, ["claude"]);
  assert.deepEqual(manifest.components.map(({ id }) => id), ["plugin/frontend-design"]);
  assert.equal(fs.existsSync(path.join(fixture.project, "AGENTS.md")), false);
  assert.equal(fs.existsSync(path.join(fixture.project, "CLAUDE.md")), false);
  const settings = JSON.parse(read(fixture.project, ".claude/settings.json"));
  assert.equal(settings.enabledPlugins["frontend-design@claude-plugins-official"], true);
});

test("init installs skills from the main catalog with portable or Claude delivery", (context) => {
  for (const [agent, scope] of [["portable", "project"], ["claude", "project"], ["claude", "user"]]) {
    const fixture = makeFixture(context);
    const result = spawnSync(process.execPath, [cli, "init", "--interactive"], {
      cwd: fixture.project,
      env: { ...process.env, HOME: fixture.home, NO_COLOR: "1" },
      encoding: "utf8", input: `i skill/review-pr\nskill/review-pr\n${agent}\n${scope}\ny\n`, timeout: 5_000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /What it does[\s\S]*Use when[\s\S]*Example[\s\S]*Consider[\s\S]*How to use/);
    assert.match(result.stdout, /Ask your agent: Use review-pr/);
    const root = scope === "user" ? fixture.home : fixture.project;
    assert.match(read(root, ".agents/skills/review-pr/SKILL.md"), /name: review-pr/);
    assert.equal(fs.existsSync(path.join(fixture.project, "AGENTS.md")), false, "skills do not need instruction blocks");
    assert.equal(fs.existsSync(path.join(root, ".claude/skills/review-pr/SKILL.md")), agent === "claude");
    const manifest = JSON.parse(read(fixture.project, ".agent-suitup/manifest.json"));
    assert.deepEqual(manifest.components, [{ id: "skill/review-pr", scope }]);
    assert.deepEqual(manifest.adapters, agent === "claude" ? ["claude"] : []);
    assert.match(run(fixture, "doctor").stdout, /Healthy.*1 component/);
  }
});

test("inspect and in-menu guides are read-only, including remote skills", async (context) => {
  const fixture = makeFixture(context);
  const before = snapshotTree(fixture.root);
  const result = run(fixture, "inspect", "skill/fastapi", "--scope", "user", "--adapter", "claude");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Use when[\s\S]*FastAPI application/);
  assert.match(result.stdout, /~\/\.agents\/skills\/fastapi\/SKILL.md/);
  assert.match(result.stdout, /downloaded only for a chosen installation plan/);
  const menu = await runInteractive(fixture, [
    [/Select numbers or ranges/, "i 11"],
    [/Select numbers or ranges/, "i skill/fastapi"],
    [/Select numbers or ranges/, "none"],
  ], "init", "--interactive");
  assert.equal(menu.status, 0, menu.stderr);
  assert.match(menu.stdout, /How to use[\s\S]*review-pr/);
  assert.deepEqual(snapshotTree(fixture.root), before);
});

for (const adapter of ["none", "claude", "grok"]) {
  for (const scope of ["project", "user"]) {
    test(`debugging and migration skills support ${scope} lifecycle with ${adapter} delivery`, (context) => {
      const fixture = makeFixture(context);
      const names = ["debug-issue", "database-migration"];
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
        assert.match(inspected.stdout, /On demand/);
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
        assert.equal(lock.components[id].version, "1.0.0");
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

      fs.unlinkSync(path.join(root, canonical("database-migration")));
      const repaired = run(fixture, "update");
      assert.equal(repaired.status, 0, repaired.stderr);
      assert.equal(read(root, canonical("database-migration")), expected("database-migration"));

      const note = ".agents/skills/debug-issue/local-notes.md";
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
    env: { ...process.env, HOME: fixture.home, NO_COLOR: "1" },
    encoding: "utf8", input: "skill/review-pr command/verify-work plugin/github\nportable\nproject\ny\n", timeout: 5_000,
  });
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(read(fixture.project, ".agent-suitup/manifest.json"));
  assert.deepEqual(manifest.adapters, ["claude"]);
  assert.deepEqual(manifest.components.map(({ id }) => id), ["command/verify-work", "plugin/github", "skill/review-pr"]);
  assert.equal(fs.existsSync(path.join(fixture.project, "AGENTS.md")), false);
  assert.match(run(fixture, "doctor").stdout, /Healthy.*3 components/);
});

test("interactive review previews exact changes and can cancel without writing", async (context) => {
  const fixture = makeFixture(context);
  fs.writeFileSync(path.join(fixture.project, "AGENTS.md"), "# Existing guidance\n");
  const before = snapshotTree(fixture.root);
  const result = await runInteractive(fixture, [
    [/Select numbers or ranges/, "3"],
    [/Agent setup/, "portable"],
    [/Install this selection/, () => {
      assert.deepEqual(snapshotTree(fixture.root), before);
      return "p";
    }],
    [/Install this selection/, "n"],
  ], "init", "--interactive", "--plain");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Ready to install[\s\S]*Completion evidence · this project/);
  assert.match(result.stdout, /UPDATE \.\/AGENTS\.md[\s\S]*\+.*<!--as:block\/completion-evidence-->/);
  assert.match(result.stdout, /Installation cancelled. No files written/);
  assert.doesNotMatch(result.stdout, /\x1b\[/);
  assert.deepEqual(snapshotTree(fixture.root), before);
});

test("interactive add recovers from typos and installs the chosen user scope", async (context) => {
  const fixture = makeFixture(context);
  const result = await runInteractive(fixture, [
    [/Select numbers or ranges/, "1-999999999999"],
    [/Select numbers or ranges/, "command/verify-work"],
    [/Agent setup/, "portable"],
    [/Default scope/, "usr"],
    [/Default scope/, "user"],
    [/Install this selection/, "maybe"],
    [/Install this selection/, "y"],
  ], "add", "--interactive");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Invalid selection/);
  assert.match(result.stdout, /Invalid scope/);
  assert.match(result.stdout, /Verify work · user \(all projects\)/);
  assert.match(read(fixture.home, ".agents/skills/verify-work/SKILL.md"), /# Verify Work/);
  const manifest = JSON.parse(read(fixture.project, ".agent-suitup/manifest.json"));
  assert.deepEqual(manifest.components, [{ id: "command/verify-work", scope: "user" }]);
});

test("interactive init recovers from an invalid agent choice", async (context) => {
  const fixture = makeFixture(context);
  const result = await runInteractive(fixture, [
    [/Select numbers or ranges/, "skill/review-pr"],
    [/Agent setup/, "cloude"],
    [/Agent setup/, "claude"],
    [/Default scope/, "project"],
    [/Install this selection/, "n"],
  ], "init", "--interactive");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Choose portable, claude, grok, or both/);
  assert.match(result.stdout, /\.claude\/skills\/review-pr/);
  assert.deepEqual(fs.readdirSync(fixture.project), []);
});

test("interactive dry run needs no install confirmation and leaves no state", async (context) => {
  const fixture = makeFixture(context);
  const result = await runInteractive(fixture, [
    [/Select numbers or ranges/, "1"],
    [/Agent setup/, "portable"],
  ], "add", "--interactive", "--dry-run");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /CREATE \.\/AGENTS\.md[\s\S]*Dry run complete/);
  assert.doesNotMatch(result.stdout, /Install this selection|Default scope/);
  assert.deepEqual(fs.readdirSync(fixture.project), []);
});

test("piped answers work when sent together and EOF never approves an installation", (context) => {
  for (const [input, expectedStatus] of [["1\nportable\ny\n", 0], ["1\nportable\n", 130], ["", 130]]) {
    const fixture = makeFixture(context);
    const result = spawnSync(process.execPath, [cli, "init", "--interactive"], {
      cwd: fixture.project,
      env: { ...process.env, HOME: fixture.home, NO_COLOR: "1" },
      encoding: "utf8", input, timeout: 5_000,
    });
    assert.equal(result.status, expectedStatus, result.stderr);
    if (expectedStatus === 0) assert.match(read(fixture.project, "AGENTS.md"), /<!--as:block\/tdd-->/);
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
    [/Select numbers or ranges/, "block/ponytail"],
    [/Agent setup/, "portable"],
    [/Install this selection/, () => {
      fs.appendFileSync(path.join(fixture.project, "AGENTS.md"), "\nNew guidance during review.\n");
      before = snapshotTree(fixture.root);
      return "y";
    }],
  ], "init", "--interactive", "--force");
  assert.equal(result.status, 1);
  assert.match(result.stdout, /Always loaded  115 words · ~205 tokens total/);
  assert.match(result.stderr, /Path changed after planning: \.\/AGENTS\.md/);
  assert.deepEqual(snapshotTree(fixture.root), before);
});

test("portable content installs canonically without vendor files", (context) => {
  const fixture = makeFixture(context);
  fs.writeFileSync(path.join(fixture.project, "AGENTS.md"), "# Team instructions\n\nKeep this text.\n");
  fs.writeFileSync(path.join(fixture.project, "CLAUDE.md"), "# Claude notes\n");

  const installed = run(fixture, "add", "block/tdd", "skill/audit-code");
  assert.equal(installed.status, 0, installed.stderr);
  const manifest = JSON.parse(read(fixture.project, ".agent-suitup/manifest.json"));
  assert.deepEqual(manifest.adapters, []);
  const agents = read(fixture.project, "AGENTS.md");
  assert.match(agents, /Keep this text/);
  assert.equal(count(agents, "<!--as:block/tdd-->"), 1);

  const claude = read(fixture.project, "CLAUDE.md");
  assert.equal(claude, "# Claude notes\n");
  assert.ok(fs.existsSync(path.join(fixture.project, ".agents", "skills", "audit-code", "SKILL.md")));
  assert.equal(fs.existsSync(path.join(fixture.project, ".claude")), false);

  const planned = run(fixture, "plan");
  assert.equal(planned.status, 0, planned.stderr);
  assert.match(planned.stdout, /Always-loaded text[\s\S]*53 words/);
  assert.match(planned.stdout, /No file changes\./);
  const healthy = run(fixture, "doctor");
  assert.equal(healthy.status, 0, healthy.stderr);
  assert.match(healthy.stdout, /Healthy.*2 components/);

  const repeated = run(fixture, "add", "block/tdd", "skill/audit-code");
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.match(repeated.stdout, /^No file changes\./);

  const removed = run(fixture, "remove", "block/tdd", "skill/audit-code");
  assert.equal(removed.status, 0, removed.stderr);
  const agentsAfter = read(fixture.project, "AGENTS.md");
  assert.match(agentsAfter, /Keep this text/);
  assert.doesNotMatch(agentsAfter, /<!--as:/);
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
    const instructions = read(fixture.project, "AGENTS.md");
    assert.ok(instructions.startsWith(original));
    assert.ok(instructions.includes(body));
    assert.equal(count(instructions, "<!--as:block/focused-changes-->"), 1);
    if (adapter === "claude") assert.equal(read(fixture.project, "CLAUDE.md"), instructions);
    const manifest = JSON.parse(read(fixture.project, ".agent-suitup/manifest.json"));
    assert.deepEqual(manifest.components, [{ id, scope: "project" }]);

    const unchanged = snapshotTree(fixture.root);
    const repeated = run(fixture, "add", id);
    assert.equal(repeated.status, 0, repeated.stderr);
    assert.deepEqual(snapshotTree(fixture.root), unchanged);
    const healthy = run(fixture, "doctor");
    assert.equal(healthy.status, 0, healthy.stderr);

    fs.writeFileSync(path.join(fixture.project, "AGENTS.md"), instructions.replace(body, `${body}Local policy edit.\n`));
    const edited = snapshotTree(fixture.root);
    const conflict = run(fixture, "remove", id);
    assert.notEqual(conflict.status, 0);
    assert.match(conflict.stderr, /Managed block has local changes/);
    assert.deepEqual(snapshotTree(fixture.root), edited);

    fs.writeFileSync(path.join(fixture.project, "AGENTS.md"), instructions);
    const removed = run(fixture, "remove", id);
    assert.equal(removed.status, 0, removed.stderr);
    assert.equal(read(fixture.project, "AGENTS.md"), original);
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
  const expected = read(first.project, "AGENTS.md");
  assert.equal(read(second.project, "AGENTS.md"), expected);
  assert.ok(expected.indexOf("# User guidance") < expected.indexOf("<!--as:block/completion-evidence-->"));
  assert.ok(expected.indexOf("<!--as:block/completion-evidence-->")
    < expected.indexOf("<!--as:block/transparent-shortcuts-->"));

  const repeated = run(first, "add", "block/transparent-shortcuts", "block/completion-evidence");
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.equal(repeated.stdout, "No file changes.\n");
  assert.equal(read(first.project, "AGENTS.md"), expected);
});

test("block drift is refused and an explicit force restores only owned content", (context) => {
  const fixture = makeFixture(context);
  fs.writeFileSync(path.join(fixture.project, "AGENTS.md"), "# User guidance\n");
  assert.equal(run(fixture, "add", "block/tdd").status, 0);
  const agents = path.join(fixture.project, "AGENTS.md");
  fs.writeFileSync(agents, fs.readFileSync(agents, "utf8").replace("Make the smallest", "Locally edit the smallest"));

  const doctor = run(fixture, "doctor");
  assert.equal(doctor.status, 1);
  assert.match(doctor.stderr, /Managed block has local changes: block\/tdd/);
  const refused = run(fixture, "add", "block/tdd");
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /Managed block has local changes/);

  const restored = run(fixture, "add", "block/tdd", "--force");
  assert.equal(restored.status, 0, restored.stderr);
  assert.match(read(fixture.project, "AGENTS.md"), /^# User guidance/m);
  assert.doesNotMatch(read(fixture.project, "AGENTS.md"), /Locally edit/);
  assert.match(run(fixture, "doctor").stdout, /Healthy/);

  const removed = run(fixture, "remove", "block/tdd");
  assert.equal(removed.status, 0, removed.stderr);
  assert.equal(read(fixture.project, "AGENTS.md"), "# User guidance\n");
});

test("retired components are rejected with an explicit removal path", (context) => {
  const fixture = makeFixture(context);
  const installed = run(fixture, "add", "skill/ponytail");
  assert.equal(installed.status, 1);
  assert.match(installed.stderr, /retired after catalog review/i);
  assert.match(installed.stderr, /agent-suitup remove skill\/ponytail/);
  assert.equal(fs.existsSync(path.join(fixture.project, ".agent-suitup")), false);
});

test("an existing retired component can still be removed safely", (context) => {
  const fixture = makeFixture(context);
  const state = path.join(fixture.project, ".agent-suitup");
  const skill = path.join(fixture.project, ".agents", "skills", "ponytail", "SKILL.md");
  fs.mkdirSync(state, { recursive: true });
  fs.mkdirSync(path.dirname(skill), { recursive: true });
  fs.writeFileSync(skill, "Legacy Ponytail skill.\n");
  fs.writeFileSync(path.join(state, "manifest.json"), `${JSON.stringify({
    manifestVersion: 2,
    adapters: [],
    components: [{ id: "skill/ponytail", scope: "project" }],
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(state, "lock.json"), `${JSON.stringify({
    lockfileVersion: 1,
    components: {
      "skill/ponytail": {
        kind: "skill",
        scope: "project",
        files: [{ path: "./.agents/skills/ponytail/SKILL.md", kind: "file" }],
      },
    },
    bridges: {},
  }, null, 2)}\n`);

  const removed = run(fixture, "remove", "skill/ponytail");
  assert.equal(removed.status, 0, removed.stderr);
  assert.equal(fs.existsSync(skill), false);
  assert.deepEqual(JSON.parse(read(fixture.project, ".agent-suitup/manifest.json")).components, []);
});

test("installs App Meerkat guidance as compact blocks and an on-demand skill", (context) => {
  const fixture = makeFixture(context);
  const blockIds = [
    "block/completion-evidence",
    "block/transparent-shortcuts",
    "block/secure-defaults",
    "block/ci-production-parity",
    "block/no-unfinished-ui",
  ];
  const ids = [...blockIds, "skill/verify-frontend"];
  fs.writeFileSync(path.join(fixture.project, "AGENTS.md"), "# Existing guidance\n");

  const installed = run(fixture, "add", ...ids);
  assert.equal(installed.status, 0, installed.stderr);
  const agents = read(fixture.project, "AGENTS.md");
  assert.match(agents, /# Existing guidance/);
  for (const id of blockIds) assert.equal(count(agents, `<!--as:${id}-->`), 1, id);
  assert.ok(fs.existsSync(path.join(fixture.project, ".agents", "skills", "verify-frontend", "SKILL.md")));

  const lock = JSON.parse(read(fixture.project, ".agent-suitup/lock.json"));
  for (const id of ids) {
    assert.equal(lock.components[id].source.upstream, "jmlero/app-meerkat");
    assert.match(lock.components[id].source.revision, /^[0-9a-f]{40}$/);
  }
  assert.match(run(fixture, "doctor").stdout, /Healthy.*6 components/);
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
    "Instruction blocks",
    "Skills",
    "Commands",
    "Agent integrations",
  ]) assert.match(listed.stdout, new RegExp(section));
  assert.doesNotMatch(listed.stdout, /External tools|Hooks & automation/);
  const blocks = run(fixture, "list", "blocks");
  assert.match(blocks.stdout, /block\/tdd[\s\S]*53 words/);
  assert.match(blocks.stdout, /block\/ponytail[\s\S]*62 words/);

  const commands = run(fixture, "list", "commands");
  assert.equal(commands.status, 0, commands.stderr);
  assert.match(commands.stdout, /command\/verify-work/);
  assert.match(commands.stdout, /command\/commit-work/);
  assert.doesNotMatch(commands.stdout, /block\/tdd/);

  const preview = run(fixture, "add", "command/verify-work", "--dry-run");
  assert.equal(preview.status, 0, preview.stderr);
  assert.match(preview.stdout, /# Verify Work/);
  assert.match(preview.stdout, /Dry run complete/);
  assert.equal(fs.existsSync(path.join(fixture.project, ".agent-suitup")), false);

  const installed = run(fixture, "add", "command/verify-work", "command/commit-work");
  assert.equal(installed.status, 0, installed.stderr);
  assert.match(installed.stdout, /Selected components/);
  assert.match(installed.stdout, /Change set/);
  assert.doesNotMatch(installed.stdout, /# Verify Work/);
  for (const name of ["verify-work", "commit-work"]) {
    assert.match(read(fixture.project, `.agents/skills/${name}/SKILL.md`), new RegExp(`name: ${name}`));
    assert.match(read(fixture.project, `.agents/skills/${name}/agents/openai.yaml`), /allow_implicit_invocation: false/);
  }
  assert.match(run(fixture, "doctor").stdout, /Healthy.*2 components/);

  const removed = run(fixture, "remove", "command/verify-work", "command/commit-work");
  assert.equal(removed.status, 0, removed.stderr);
  assert.equal(fs.existsSync(path.join(fixture.project, ".agents", "skills", "verify-work", "SKILL.md")), false);
  assert.equal(fs.existsSync(path.join(fixture.project, ".agents", "skills", "commit-work", "SKILL.md")), false);
});

test("Claude adapter exposes canonical blocks and skills without duplicating them", (context) => {
  const fixture = makeFixture(context);
  fs.writeFileSync(path.join(fixture.project, "CLAUDE.md"), "# Claude notes\n");

  const installed = run(fixture, "add", "block/tdd", "skill/audit-code", "--adapter", "claude");
  assert.equal(installed.status, 0, installed.stderr);
  assert.match(read(fixture.project, "CLAUDE.md"), /@AGENTS\.md/);
  if (process.platform !== "win32") {
    assert.equal(fs.lstatSync(path.join(fixture.project, ".claude", "skills", "audit-code")).isSymbolicLink(), true);
  }

  const disabled = run(fixture, "add", "block/tdd", "skill/audit-code", "--adapter", "none");
  assert.equal(disabled.status, 0, disabled.stderr);
  assert.equal(read(fixture.project, "CLAUDE.md"), "# Claude notes\n");
  assert.equal(fs.existsSync(path.join(fixture.project, ".claude", "skills", "audit-code")), false);
  assert.ok(fs.existsSync(path.join(fixture.project, ".agents", "skills", "audit-code", "SKILL.md")));
});

test("Claude bridge is symlink-first and removes only an owned bridge", { skip: process.platform === "win32" }, (context) => {
  const fixture = makeFixture(context);
  const installed = run(fixture, "add", "block/tdd", "--adapter", "claude");
  assert.equal(installed.status, 0, installed.stderr);
  const bridge = path.join(fixture.project, "CLAUDE.md");
  assert.equal(fs.lstatSync(bridge).isSymbolicLink(), true);
  assert.equal(fs.readlinkSync(bridge), "AGENTS.md");
  assert.match(read(fixture.project, "AGENTS.md"), /<!--as:block\/tdd-->/);

  const removed = run(fixture, "remove", "block/tdd");
  assert.equal(removed.status, 0, removed.stderr);
  assert.equal(fs.existsSync(bridge), false);
});

test("Claude adopts an existing AGENTS import without duplicating or owning it", (context) => {
  const fixture = makeFixture(context);
  const existing = "# Claude-only guidance\n\n@AGENTS.md\n";
  fs.writeFileSync(path.join(fixture.project, "CLAUDE.md"), existing);

  const installed = run(fixture, "add", "block/tdd", "--adapter", "claude");
  assert.equal(installed.status, 0, installed.stderr);
  assert.equal(read(fixture.project, "CLAUDE.md"), existing);
  const lock = JSON.parse(read(fixture.project, ".agent-suitup/lock.json"));
  assert.equal(lock.bridges.claudeAgents.managed, "import");
  assert.equal(lock.bridges.claudeAgents.owned, false);

  const removed = run(fixture, "remove", "block/tdd");
  assert.equal(removed.status, 0, removed.stderr);
  assert.equal(read(fixture.project, "CLAUDE.md"), existing);
});

test("Claude adopts a valid existing symlink and leaves it on removal", { skip: process.platform === "win32" }, (context) => {
  const fixture = makeFixture(context);
  fs.writeFileSync(path.join(fixture.project, "AGENTS.md"), "# Existing\n");
  fs.symlinkSync("AGENTS.md", path.join(fixture.project, "CLAUDE.md"));

  const installed = run(fixture, "add", "block/tdd", "--adapter", "claude");
  assert.equal(installed.status, 0, installed.stderr);
  const lock = JSON.parse(read(fixture.project, ".agent-suitup/lock.json"));
  assert.equal(lock.bridges.claudeAgents.managed, "symlink");
  assert.equal(lock.bridges.claudeAgents.owned, false);

  const removed = run(fixture, "remove", "block/tdd");
  assert.equal(removed.status, 0, removed.stderr);
  assert.equal(fs.lstatSync(path.join(fixture.project, "CLAUDE.md")).isSymbolicLink(), true);
  assert.equal(read(fixture.project, "AGENTS.md"), "# Existing\n");
});

test("doctor safely repairs a replaced Claude symlink as a preserved overlay", { skip: process.platform === "win32" }, (context) => {
  const fixture = makeFixture(context);
  assert.equal(run(fixture, "add", "block/tdd", "--adapter", "claude").status, 0);
  const bridge = path.join(fixture.project, "CLAUDE.md");
  fs.unlinkSync(bridge);
  fs.writeFileSync(bridge, "# Claude-only overlay\n");

  const doctor = run(fixture, "doctor");
  assert.equal(doctor.status, 1);
  assert.match(doctor.stderr, /UPDATE \.\/CLAUDE\.md/);
  assert.match(doctor.stderr, /@AGENTS\.md/);

  const repaired = run(fixture, "update");
  assert.equal(repaired.status, 0, repaired.stderr);
  const content = read(fixture.project, "CLAUDE.md");
  assert.match(content, /# Claude-only overlay/);
  assert.match(content, /@AGENTS\.md/);
  assert.match(run(fixture, "doctor").stdout, /Healthy/);

  assert.equal(run(fixture, "remove", "block/tdd").status, 0);
  assert.equal(read(fixture.project, "CLAUDE.md"), "# Claude-only overlay\n");
});

test("Claude refuses an unrelated symlink unless force explicitly replaces it", { skip: process.platform === "win32" }, (context) => {
  const fixture = makeFixture(context);
  fs.writeFileSync(path.join(fixture.project, "OTHER.md"), "# Other\n");
  fs.symlinkSync("OTHER.md", path.join(fixture.project, "CLAUDE.md"));

  const refused = run(fixture, "add", "block/tdd", "--adapter", "claude");
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /Cannot create Claude bridge/);
  assert.equal(fs.readlinkSync(path.join(fixture.project, "CLAUDE.md")), "OTHER.md");

  const forced = run(fixture, "add", "block/tdd", "--adapter", "claude", "--force");
  assert.equal(forced.status, 0, forced.stderr);
  assert.equal(fs.readlinkSync(path.join(fixture.project, "CLAUDE.md")), "AGENTS.md");
});

test("cleanup refuses a Claude bridge that changed type until force is explicit", { skip: process.platform === "win32" }, (context) => {
  const fixture = makeFixture(context);
  assert.equal(run(fixture, "add", "block/tdd", "--adapter", "claude").status, 0);
  const bridge = path.join(fixture.project, "CLAUDE.md");
  fs.unlinkSync(bridge);
  fs.writeFileSync(bridge, "# Claude-only overlay\n");
  const before = snapshotTree(fixture.root);

  for (const arguments_ of [
    ["remove", "block/tdd"],
    ["add", "block/tdd", "--adapter", "none"],
  ]) {
    const refused = run(fixture, ...arguments_);
    assert.equal(refused.status, 1, refused.stdout);
    assert.match(refused.stderr, /changed type.*CLAUDE\.md/i);
    assert.deepEqual(snapshotTree(fixture.root), before);
  }

  const preview = run(fixture, "remove", "block/tdd", "--force", "--dry-run");
  assert.equal(preview.status, 0, preview.stderr);
  assert.match(preview.stdout, /DELETE \.\/CLAUDE\.md\n-# Claude-only overlay/);
  assert.deepEqual(snapshotTree(fixture.root), before);

  const removed = run(fixture, "remove", "block/tdd", "--force");
  assert.equal(removed.status, 0, removed.stderr);
  assert.equal(fs.existsSync(bridge), false);
  assert.match(run(fixture, "doctor").stdout, /Healthy/);
});

test("cleanup refuses a user skill bridge that changed type when removing or disabling Claude", { skip: process.platform === "win32" }, (context) => {
  const fixture = makeFixture(context);
  assert.equal(run(fixture, "add", "skill/audit-code", "--scope", "user", "--adapter", "claude").status, 0);
  const canonical = read(fixture.home, ".agents/skills/audit-code/SKILL.md");
  const bridge = path.join(fixture.home, ".claude", "skills", "audit-code");
  fs.unlinkSync(bridge);
  fs.writeFileSync(bridge, "User-authored replacement.\n");
  const before = snapshotTree(fixture.root);

  for (const arguments_ of [
    ["remove", "skill/audit-code"],
    ["add", "skill/audit-code", "--adapter", "none"],
  ]) {
    const refused = run(fixture, ...arguments_);
    assert.equal(refused.status, 1, refused.stdout);
    assert.match(refused.stderr, /changed type.*audit-code/i);
    assert.deepEqual(snapshotTree(fixture.root), before);
  }

  const disabled = run(fixture, "add", "skill/audit-code", "--adapter", "none", "--force");
  assert.equal(disabled.status, 0, disabled.stderr);
  assert.equal(fs.existsSync(bridge), false);
  assert.equal(read(fixture.home, ".agents/skills/audit-code/SKILL.md"), canonical);
  assert.match(run(fixture, "doctor").stdout, /Healthy/);
});

test("cleanup refuses a skill file that changed type during removal or scope migration", { skip: process.platform === "win32" }, (context) => {
  const fixture = makeFixture(context);
  assert.equal(run(fixture, "add", "skill/audit-code").status, 0);
  const skill = path.join(fixture.project, ".agents", "skills", "audit-code", "SKILL.md");
  const target = path.join(fixture.home, "custom-skill.md");
  fs.writeFileSync(target, "User-authored skill.\n");
  fs.unlinkSync(skill);
  fs.symlinkSync(target, skill);
  const before = snapshotTree(fixture.root);

  for (const arguments_ of [
    ["remove", "skill/audit-code"],
    ["add", "skill/audit-code", "--scope", "user"],
  ]) {
    const refused = run(fixture, ...arguments_);
    assert.equal(refused.status, 1, refused.stdout);
    assert.match(refused.stderr, /changed type.*SKILL\.md/i);
    assert.deepEqual(snapshotTree(fixture.root), before);
  }

  const removed = run(fixture, "remove", "skill/audit-code", "--force");
  assert.equal(removed.status, 0, removed.stderr);
  assert.throws(() => fs.lstatSync(skill), { code: "ENOENT" });
  assert.deepEqual(snapshotTree(fixture.home), before.home.entries);
  assert.match(run(fixture, "doctor").stdout, /Healthy/);
});

test("cleanup preserves a replacement directory even when force is explicit", (context) => {
  const fixture = makeFixture(context);
  assert.equal(run(fixture, "add", "skill/audit-code").status, 0);
  const skill = path.join(fixture.project, ".agents", "skills", "audit-code", "SKILL.md");
  fs.unlinkSync(skill);
  fs.mkdirSync(skill);
  fs.writeFileSync(path.join(skill, "notes.md"), "Keep these notes.\n");
  const before = snapshotTree(fixture.root);

  for (const flags of [[], ["--force"]]) {
    const refused = run(fixture, "remove", "skill/audit-code", ...flags);
    assert.equal(refused.status, 1, refused.stdout);
    assert.match(refused.stderr, /Refusing to delete directory/);
    assert.deepEqual(snapshotTree(fixture.root), before);
  }
});

test("detects drift and refuses destructive removal unless forced", (context) => {
  const fixture = makeFixture(context);
  const installed = run(fixture, "add", "skill/audit-code");
  assert.equal(installed.status, 0, installed.stderr);
  const skill = path.join(fixture.project, ".agents", "skills", "audit-code", "SKILL.md");
  fs.appendFileSync(skill, "\nLocal edit.\n");

  const doctor = run(fixture, "doctor");
  assert.equal(doctor.status, 1);
  assert.match(doctor.stderr, /local changes/i);
  const refused = run(fixture, "remove", "skill/audit-code");
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /local changes/i);
  assert.ok(fs.existsSync(skill));

  const forced = run(fixture, "remove", "skill/audit-code", "--force");
  assert.equal(forced.status, 0, forced.stderr);
  assert.equal(fs.existsSync(skill), false);
});

test("Claude marketplace edits preserve unrelated settings", (context) => {
  const fixture = makeFixture(context);
  fs.mkdirSync(path.join(fixture.project, ".claude"), { recursive: true });
  fs.mkdirSync(path.join(fixture.home, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(fixture.project, ".claude", "settings.json"), '{"permissions":{"allow":["Read"]}}\n');
  fs.writeFileSync(path.join(fixture.home, ".claude", "settings.json"), '{"theme":"dark"}\n');

  const installed = run(fixture, "add", "plugin/github");
  assert.equal(installed.status, 0, installed.stderr);
  assert.deepEqual(JSON.parse(read(fixture.project, ".agent-suitup/manifest.json")).adapters, ["claude"]);
  const projectSettings = JSON.parse(read(fixture.project, ".claude/settings.json"));
  const userSettings = JSON.parse(read(fixture.home, ".claude/settings.json"));
  assert.deepEqual(projectSettings.permissions, { allow: ["Read"] });
  assert.equal(projectSettings.enabledPlugins["github@claude-plugins-official"], true);
  assert.equal(userSettings.theme, "dark");
  assert.equal(userSettings.extraKnownMarketplaces["claude-plugins-official"].source.repo, "anthropics/claude-plugins-official");

  const removed = run(fixture, "remove", "plugin/github");
  assert.equal(removed.status, 0, removed.stderr);
  const projectAfter = JSON.parse(read(fixture.project, ".claude/settings.json"));
  assert.deepEqual(projectAfter.permissions, { allow: ["Read"] });
  assert.equal(projectAfter.enabledPlugins, undefined);
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

test("an interactive scope choice takes precedence over a plugin recommendation", (context) => {
  const fixture = makeFixture(context);
  const executableDirectory = path.join(fixture.root, "bin");
  fs.mkdirSync(executableDirectory);
  fs.writeFileSync(path.join(executableDirectory, "typescript-language-server"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const result = spawnSync(process.execPath, [cli, "init", "--interactive"], {
    cwd: fixture.project,
    env: { ...process.env, HOME: fixture.home, PATH: executableDirectory },
    encoding: "utf8", input: "plugin/typescript-lsp\nproject\ny\n", timeout: 5_000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /TypeScript LSP · this project/);
  assert.deepEqual(JSON.parse(read(fixture.project, ".agent-suitup/manifest.json")).components,
    [{ id: "plugin/typescript-lsp", scope: "project" }]);
  assert.equal(JSON.parse(read(fixture.project, ".claude/settings.json"))
    .enabledPlugins["typescript-lsp@claude-plugins-official"], true);
});

test("Grok adapter makes portable commands slash-only without copying their workflow", (context) => {
  const fixture = makeFixture(context);
  const installed = run(fixture, "add", "command/verify-work", "--adapter", "grok");
  assert.equal(installed.status, 0, installed.stderr);

  const canonical = read(fixture.project, ".agents/skills/verify-work/SKILL.md");
  assert.doesNotMatch(canonical, /disable-model-invocation/);
  const bridge = read(fixture.project, ".grok/skills/verify-work/SKILL.md");
  assert.match(bridge, /disable-model-invocation: true/);
  assert.match(bridge, /\.\.\/\.\.\/\.\.\/\.agents\/skills\/verify-work\/SKILL\.md/);
  assert.doesNotMatch(bridge, /Discover validation commands/);
  assert.match(run(fixture, "doctor").stdout, /Healthy.*1 component/);

  const portable = run(fixture, "add", "command/verify-work", "--adapter", "none");
  assert.equal(portable.status, 0, portable.stderr);
  assert.equal(fs.existsSync(path.join(fixture.project, ".grok", "skills", "verify-work", "SKILL.md")), false);
  assert.ok(fs.existsSync(path.join(fixture.project, ".agents", "skills", "verify-work", "SKILL.md")));
});

test("adapter-specific components reject an explicitly disabled adapter", (context) => {
  const fixture = makeFixture(context);
  const result = run(fixture, "add", "plugin/github", "--adapter", "none");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /requires one of these adapters: claude/);
  assert.equal(fs.existsSync(path.join(fixture.project, ".agent-suitup")), false);
});

test("legacy manifests and target flags migrate to optional adapters", (context) => {
  const fixture = makeFixture(context);
  fs.mkdirSync(path.join(fixture.project, ".agent-suitup"));
  fs.writeFileSync(path.join(fixture.project, ".agent-suitup", "manifest.json"), `${JSON.stringify({
    manifestVersion: 1,
    targets: ["codex"],
    components: [],
  }, null, 2)}\n`);

  const added = run(fixture, "add", "block/tdd");
  assert.equal(added.status, 0, added.stderr);
  const manifest = JSON.parse(read(fixture.project, ".agent-suitup/manifest.json"));
  assert.equal(manifest.manifestVersion, 2);
  assert.deepEqual(manifest.adapters, []);
  assert.equal(Object.hasOwn(manifest, "targets"), false);
  assert.equal(fs.existsSync(path.join(fixture.project, "CLAUDE.md")), false);

  const legacyFlag = run(fixture, "add", "block/tdd", "--target", "claude,codex");
  assert.equal(legacyFlag.status, 0, legacyFlag.stderr);
  assert.deepEqual(JSON.parse(read(fixture.project, ".agent-suitup/manifest.json")).adapters, ["claude"]);
  assert.ok(fs.existsSync(path.join(fixture.project, "CLAUDE.md")));
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
    env: { ...process.env, HOME: fixture.home, ...environment },
  });
}

function runInteractive(fixture, steps, ...arguments_) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...arguments_], {
      cwd: fixture.project,
      env: { ...process.env, HOME: fixture.home },
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
