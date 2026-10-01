import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { getComponent } from "../src/catalog.mjs";
import { reconcile } from "../src/reconcile.mjs";
import { emptyLock, jsonDocument, statePaths } from "../src/state.mjs";

test("remote skill packages install, detect drift, update, and remove every file", async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-suitup-remote-skill-"));
  const cwd = path.join(root, "project");
  const home = path.join(root, "home");
  fs.mkdirSync(cwd);
  fs.mkdirSync(home);
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const component = getComponent("skill/fastapi");
  const pinnedUrl = component.content.url;
  const pinned = revisionOf(pinnedUrl);
  const next = "2".repeat(40);
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
    component.content.url = pinnedUrl;
  });
  globalThis.fetch = remoteFixture({ [pinned]: 1, [next]: 2 });

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
  const diagram = path.join(skillRoot, "assets", "diagram.png");
  assert.match(fs.readFileSync(skill, "utf8"), /Project compatibility/);
  assert.equal(fs.readFileSync(dependencyReference, "utf8"), "# Dependencies v1\n");
  assert.equal(fs.readFileSync(license, "utf8"), "MIT License\n");
  assert.deepEqual(fs.readFileSync(diagram), binaryAsset, "binary files keep their exact bytes");
  assert.equal(first.lock.components["skill/fastapi"].source.revision, pinned);
  assert.equal(first.lock.components["skill/fastapi"].source.resolvedFiles.length, 4);
  assert.equal(first.lock.components["skill/fastapi"].files.filter(({ fallbackCopy }) => !fallbackCopy).length, 4);

  const repeated = await reconcile({ cwd, home, manifest, previousLock: first.lock });
  assert.equal(repeated.planner.hasChanges(), false);
  assert.deepEqual(repeated.lock, first.lock);

  fs.appendFileSync(dependencyReference, "Local edit.\n");
  await assert.rejects(
    reconcile({ cwd, home, manifest, previousLock: first.lock }),
    /Managed file has local changes.*references\/dependencies\.md/,
  );
  fs.writeFileSync(dependencyReference, "# Dependencies v1\n");

  // A catalog bump pins the next reviewed revision; update installs it.
  component.content.url = pinnedUrl.replace(pinned, next);
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
  assert.equal(updated.lock.components["skill/fastapi"].source.revision, next);
  assert.deepEqual(fs.readFileSync(diagram), binaryAsset);

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
  assert.equal(fs.existsSync(diagram), false);
});

test("apply refuses content created during remote planning even with force", async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-suitup-remote-race-"));
  const cwd = path.join(root, "project");
  const home = path.join(root, "home");
  fs.mkdirSync(cwd);
  fs.mkdirSync(home);
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const skillRoot = path.join(home, ".agents", "skills", "audit-docs");
  const skill = path.join(skillRoot, "SKILL.md");
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  const fetchFixture = remoteFixture({ [revisionOf(getComponent("skill/fastapi").content.url)]: 1 });
  globalThis.fetch = async (url, options) => {
    // The earlier bundled skill is already planned when the remote fetch starts.
    fs.mkdirSync(skillRoot, { recursive: true });
    fs.writeFileSync(skill, "User-created guidance during download.\n");
    return fetchFixture(url, options);
  };

  const manifest = {
    manifestVersion: 2,
    adapters: [],
    components: [
      { id: "skill/audit-docs", scope: "user" },
      { id: "skill/fastapi", scope: "project" },
    ],
  };
  const result = await reconcile({ cwd, home, manifest, previousLock: emptyLock(), force: true });
  const state = statePaths(cwd);
  result.planner.write(state.manifest, jsonDocument(manifest), { allowExisting: true });
  result.planner.write(state.lock, jsonDocument(result.lock), { allowExisting: true });

  assert.throws(() => result.planner.apply(), /changed after planning.*audit-docs/);
  assert.equal(fs.readFileSync(skill, "utf8"), "User-created guidance during download.\n");
  assert.deepEqual(fs.readdirSync(cwd), []);
  assert.deepEqual(fs.readdirSync(path.dirname(skillRoot)), ["audit-docs"]);
  assert.deepEqual(fs.readdirSync(skillRoot), ["SKILL.md"]);
});

const binaryAsset = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0x0d, 0x0a]);

function revisionOf(url) {
  return /\/([0-9a-f]{40})\//.exec(url)[1];
}

// Serves upstream content for each known revision, like an immutable GitHub tree.
function remoteFixture(generations) {
  return async (url, options) => {
    const value = String(url);
    assert.ok(options?.signal instanceof AbortSignal, "remote fetches carry a timeout signal");
    assert.doesNotMatch(value, /\/commits\//, "pinned sources never resolve a branch");
    const generation = generations[/(?:trees\/|\/fastapi\/)([0-9a-f]{40})/.exec(value)?.[1]];
    if (!generation) return { ok: false, status: 404 };

    if (value.includes("/git/trees/")) {
      const reference = generation === 1 ? "dependencies" : "routing";
      return responseJson({
        truncated: false,
        tree: [
          { path: "fastapi/.agents/skills/fastapi/SKILL.md", type: "blob", mode: "100644", size: 90 },
          { path: `fastapi/.agents/skills/fastapi/references/${reference}.md`, type: "blob", mode: "100644", size: 30 },
          { path: "fastapi/.agents/skills/fastapi/assets/diagram.png", type: "blob", mode: "100644", size: binaryAsset.length },
          { path: "LICENSE", type: "blob", mode: "100644", size: 20 },
        ],
      });
    }
    if (value.endsWith("/SKILL.md")) {
      return responseBytes(`---\nname: fastapi\ndescription: Remote FastAPI skill.\n---\n\n# FastAPI v${generation}\n`);
    }
    if (value.endsWith("/references/dependencies.md")) return responseBytes("# Dependencies v1\n");
    if (value.endsWith("/references/routing.md")) return responseBytes("# Routing v2\n");
    if (value.endsWith("/assets/diagram.png")) return responseBytes(binaryAsset);
    if (value.endsWith("/LICENSE")) return responseBytes("MIT License\n");
    return { ok: false, status: 404 };
  };
}

function responseJson(value) {
  return responseBytes(JSON.stringify(value));
}

function responseBytes(value) {
  const bytes = Buffer.from(value);
  return { ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) };
}
