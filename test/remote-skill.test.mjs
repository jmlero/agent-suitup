import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { reconcile } from "../src/reconcile.mjs";
import { emptyLock, jsonDocument, statePaths } from "../src/state.mjs";

test("remote skill packages install, detect drift, update, and remove every file", async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-suitup-remote-skill-"));
  const cwd = path.join(root, "project");
  const home = path.join(root, "home");
  fs.mkdirSync(cwd);
  fs.mkdirSync(home);
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  let generation = 1;
  globalThis.fetch = remoteFixture(() => generation);

  const manifest = {
    manifestVersion: 2,
    adapters: [],
    components: [{ id: "skill/fastapi", scope: "project" }],
  };
  const first = await reconcile({ cwd, home, manifest, previousLock: emptyLock() });
  first.planner.apply();

  const skillRoot = path.join(cwd, ".agents", "skills", "fastapi");
  const skill = path.join(skillRoot, "SKILL.md");
  const dependencyReference = path.join(skillRoot, "references", "dependencies.md");
  const routingReference = path.join(skillRoot, "references", "routing.md");
  const license = path.join(skillRoot, "LICENSE");
  assert.match(fs.readFileSync(skill, "utf8"), /Project compatibility/);
  assert.equal(fs.readFileSync(dependencyReference, "utf8"), "# Dependencies v1\n");
  assert.equal(fs.readFileSync(license, "utf8"), "MIT License\n");
  assert.equal(first.lock.components["skill/fastapi"].source.resolvedFiles.length, 3);
  assert.equal(first.lock.components["skill/fastapi"].files.filter(({ fallbackCopy }) => !fallbackCopy).length, 3);

  const repeated = await reconcile({ cwd, home, manifest, previousLock: first.lock });
  assert.equal(repeated.planner.hasChanges(), false);
  assert.deepEqual(repeated.lock, first.lock);

  fs.appendFileSync(dependencyReference, "Local edit.\n");
  await assert.rejects(
    reconcile({ cwd, home, manifest, previousLock: first.lock }),
    /Managed file has local changes.*references\/dependencies\.md/,
  );
  fs.writeFileSync(dependencyReference, "# Dependencies v1\n");

  generation = 2;
  const updated = await reconcile({
    cwd,
    home,
    manifest,
    previousLock: first.lock,
    refreshRemote: true,
  });
  updated.planner.apply();
  assert.equal(fs.existsSync(dependencyReference), false);
  assert.equal(fs.readFileSync(routingReference, "utf8"), "# Routing v2\n");
  assert.match(fs.readFileSync(skill, "utf8"), /FastAPI v2/);
  assert.equal(updated.lock.components["skill/fastapi"].source.revision, "2".repeat(40));

  const removed = await reconcile({
    cwd,
    home,
    manifest: { ...manifest, components: [] },
    previousLock: updated.lock,
  });
  removed.planner.apply();
  assert.equal(fs.existsSync(skill), false);
  assert.equal(fs.existsSync(routingReference), false);
  assert.equal(fs.existsSync(license), false);
});

test("apply refuses content created during remote planning even with force", async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-suitup-remote-race-"));
  const cwd = path.join(root, "project");
  const home = path.join(root, "home");
  fs.mkdirSync(cwd);
  fs.mkdirSync(home);
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const skillRoot = path.join(home, ".agents", "skills", "audit-code");
  const skill = path.join(skillRoot, "SKILL.md");
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  const fetchFixture = remoteFixture(() => 1);
  globalThis.fetch = async (url) => {
    // The earlier bundled skill is already planned when the remote fetch starts.
    fs.mkdirSync(skillRoot, { recursive: true });
    fs.writeFileSync(skill, "User-created guidance during download.\n");
    return fetchFixture(url);
  };

  const manifest = {
    manifestVersion: 2,
    adapters: [],
    components: [
      { id: "skill/audit-code", scope: "user" },
      { id: "skill/fastapi", scope: "project" },
    ],
  };
  const result = await reconcile({ cwd, home, manifest, previousLock: emptyLock(), force: true });
  const state = statePaths(cwd);
  result.planner.write(state.manifest, jsonDocument(manifest), { allowExisting: true });
  result.planner.write(state.lock, jsonDocument(result.lock), { allowExisting: true });

  assert.throws(() => result.planner.apply(), /changed after planning.*audit-code/);
  assert.equal(fs.readFileSync(skill, "utf8"), "User-created guidance during download.\n");
  assert.deepEqual(fs.readdirSync(cwd), []);
  assert.deepEqual(fs.readdirSync(path.dirname(skillRoot)), ["audit-code"]);
  assert.deepEqual(fs.readdirSync(skillRoot), ["SKILL.md"]);
});

function remoteFixture(getGeneration) {
  return async (url) => {
    const value = String(url);
    const generation = getGeneration();
    const revision = String(generation).repeat(40);
    const treeSha = generation === 1 ? "a".repeat(40) : "b".repeat(40);

    if (value.includes("/commits/")) {
      return responseJson({ sha: revision, commit: { tree: { sha: treeSha } } });
    }
    if (value.includes("/git/trees/")) {
      const reference = generation === 1 ? "dependencies" : "routing";
      return responseJson({
        truncated: false,
        tree: [
          { path: "fastapi/.agents/skills/fastapi/SKILL.md", type: "blob", mode: "100644", size: 90 },
          { path: `fastapi/.agents/skills/fastapi/references/${reference}.md`, type: "blob", mode: "100644", size: 30 },
          { path: "LICENSE", type: "blob", mode: "100644", size: 20 },
        ],
      });
    }
    if (value.endsWith("/SKILL.md")) {
      return responseText(`---\nname: fastapi\ndescription: Remote FastAPI skill.\n---\n\n# FastAPI v${generation}\n`);
    }
    if (value.endsWith("/references/dependencies.md")) return responseText("# Dependencies v1\n");
    if (value.endsWith("/references/routing.md")) return responseText("# Routing v2\n");
    if (value.endsWith("/LICENSE")) return responseText("MIT License\n");
    return { ok: false, status: 404 };
  };
}

function responseJson(value) {
  return { ok: true, json: async () => value };
}

function responseText(value) {
  return { ok: true, text: async () => value };
}
