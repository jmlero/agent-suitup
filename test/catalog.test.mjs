import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { componentGuide } from "../src/component-guide.mjs";
import {
  aggregateContextCost,
  availableWithAdapters,
  bundledContent,
  bundledPackage,
  componentContextCost,
  catalogConflicts,
  isPortable,
  listComponents,
  lockedRemoteContent,
  lockedRemotePackage,
  remoteContent,
  resolveRemotePackage,
  retiredComponentIds,
  suggested,
  validateCatalogComponent,
} from "../src/catalog.mjs";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appMeerkatBlockIds = [
  "block/completion-evidence",
  "block/transparent-shortcuts",
  "block/secure-defaults",
  "block/ci-production-parity",
  "block/no-unfinished-ui",
];

test("catalog contains the reviewed block-first component set", () => {
  const components = listComponents();
  const ids = components.map(({ id }) => id);
  assert.equal(components.length, 23);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of [
    "block/tdd",
    "block/ponytail",
    ...appMeerkatBlockIds,
    "block/focused-changes",
    "skill/audit-code",
    "skill/audit-docs",
    "skill/review-pr",
    "skill/verify-frontend",
    "skill/terraform-skill",
    "skill/fastapi",
    "skill/debug-issue",
    "skill/database-migration",
    "command/verify-work",
    "command/commit-work",
    "plugin/frontend-design",
    "plugin/typescript-lsp",
    "plugin/pyright-lsp",
    "plugin/github",
    "plugin/codex",
  ]) assert.ok(ids.includes(id), id);

  assert.ok([...retiredComponentIds].every((id) => !ids.includes(id)));
  for (const component of components) {
    assert.match(component.version, /^\d+\.\d+\.\d+$/);
    assert.ok(component.scopes.length);
    assert.equal(Object.hasOwn(component, "targets"), false);
    if (component.adapters) assert.deepEqual(component.adapters, ["claude"]);
    if (component.content?.kind === "bundled") assert.ok(bundledContent(component).length > 20);
    if (component.kind === "block") {
      assert.equal(component.context.loading, "always");
      assert.ok(component.outcome);
      assert.ok(component.alwaysOnJustification);
      assert.equal(Object.hasOwn(component.context, "estimatedTokens"), false);
      const cost = componentContextCost(component);
      assert.ok(cost.words > 0, `${component.id}: ${cost.words} words`);
      assert.ok(cost.estimatedTokens > 0, component.id);
    }
  }
});

test("every catalog component has a recorded form and deletion-pressure decision", () => {
  const review = ["catalog-review-2026-08-15.md", "catalog-review-2026-09-07.md"]
    .map((file) => fs.readFileSync(path.join(repository, "docs", file), "utf8"))
    .join("\n");
  for (const { id } of listComponents()) assert.ok(review.includes("`" + id + "`"), id);
  assert.match(review, /Removed forms/);

  const workflow = fs.readFileSync(path.join(repository, "docs", "evaluations", "README.md"), "utf8");
  for (const outcome of ["retain", "shorten", "demote", "replace", "remove", "reject"]) {
    assert.match(workflow, new RegExp(`\\*\\*${outcome}\\*\\*`));
  }
  const baseline = fs.readFileSync(
    path.join(repository, "docs", "evaluations", "records", "2026-08-15-completion-evidence.md"),
    "utf8",
  );
  assert.match(baseline, /Control, without the block/);
  assert.match(baseline, /Treatment, with the block/);
  assert.match(baseline, /not recommendation evidence/i);
});

test("selection guides explain every component and browsing never fetches remote content", (context) => {
  context.mock.method(globalThis, "fetch", () => { throw new Error("Browsing must not download"); });
  for (const component of listComponents()) {
    for (const field of ["when", "consider", "example"]) assert.ok(component.selection[field].length > 20, component.id);
    const guide = componentGuide(component, { scope: "user", adapters: ["claude"] });
    if (component.kind === "block") assert.equal(guide.destination, "./AGENTS.md");
    else assert.ok(guide.destination.startsWith("~/"));
    if (component.kind === "skill") {
      assert.match(guide.sections.find(([title]) => title === "Loading")[1], /On demand/);
      assert.match(guide.sections.find(([title]) => title === "Agent setup")[1], /~\/\.claude\/skills/);
    }
    assert.throws(() => validateCatalogComponent({ ...component, selection: { ...component.selection, example: "" } }), /selection guide must declare example/);
  }
});

test("self-hosted instructions no longer require linked short modules", () => {
  const instructions = fs.readFileSync(path.join(repository, "AGENTS.md"), "utf8");
  assert.match(instructions, /## Workflow/);
  assert.doesNotMatch(instructions, /agents\/(instruction-modules|todo-workflow)\.md/);
  assert.equal(fs.existsSync(path.join(repository, "agents", "instruction-modules.md")), false);
  assert.equal(fs.existsSync(path.join(repository, "agents", "todo-workflow.md")), false);
});

test("rejected Karpathy and memory candidates remain documented no-ops", () => {
  const ids = listComponents().map(({ id }) => id);
  assert.ok(ids.every((id) => !/karpathy|memory/.test(id)));
  for (const record of [
    "2026-08-15-karpathy-guidelines.md",
    "2026-08-15-agent-memory.md",
  ]) {
    const content = fs.readFileSync(path.join(repository, "docs", "evaluations", "records", record), "utf8");
    assert.match(content, /install(?:s)? nothing/i);
    assert.match(content, /\*\*Reject/);
  }
});

test("word and token costs are derived and aggregate only always-loaded blocks", () => {
  const blocks = listComponents().filter(({ kind }) => kind === "block");
  const total = aggregateContextCost(blocks);
  assert.equal(total.words, blocks.reduce((sum, component) => sum + componentContextCost(component).words, 0));
  assert.equal(total.estimatedTokens, blocks.reduce(
    (sum, component) => sum + componentContextCost(component).estimatedTokens,
    0,
  ));
  assert.deepEqual(aggregateContextCost(listComponents().filter(({ kind }) => kind !== "block")), {
    words: 0,
    estimatedTokens: 0,
  });
});

test("block size informs context costs without determining validity", (context) => {
  const block = listComponents().find(({ id }) => id === "block/tdd");
  const source = path.join(repository, "catalog", block.content.path);
  const readFile = fs.readFileSync;
  let content;
  context.mock.method(fs, "readFileSync", (file, ...options) => file === source
    ? content
    : readFile(file, ...options));

  const short = "Keep unrelated working-tree changes out of commits.\n";
  const long = [
    "When a change affects a database migration, inspect the current schema and the deployment sequence.",
    "Keep the migration compatible with the application version that remains live during deployment.",
    "Separate destructive cleanup from introducing replacement fields so existing readers can keep working.",
    "Check whether backfills can be resumed and whether they hold locks that block normal requests.",
    "Exercise the migration against representative existing data and record how to recover from a partial failure.",
    "If the environment cannot reproduce these conditions, report the missing evidence before claiming readiness.",
    "For a disposable local database, use the repository's documented reset workflow when production compatibility is irrelevant.",
  ].join("\n") + "\n";

  for (const fixture of [short, long]) {
    content = fixture;
    const expected = {
      words: fixture.trim().split(/\s+/u).length,
      estimatedTokens: Math.ceil(Buffer.byteLength(fixture, "utf8") / 4),
    };
    assert.ok(expected.estimatedTokens < 30 || expected.estimatedTokens > 150);
    assert.doesNotThrow(() => validateCatalogComponent(block));
    assert.deepEqual(componentContextCost(block), expected);
    assert.deepEqual(aggregateContextCost([block]), expected);
  }
});

test("blocks still require nonempty guidance", (context) => {
  const block = listComponents().find(({ id }) => id === "block/tdd");
  const source = path.join(repository, "catalog", block.content.path);
  const readFile = fs.readFileSync;
  let content;
  context.mock.method(fs, "readFileSync", (file, ...options) => file === source
    ? content
    : readFile(file, ...options));

  for (const fixture of ["", " \t\r\n  "]) {
    content = fixture;
    assert.throws(() => validateCatalogComponent(block), /must contain guidance/);
  }
});

test("App Meerkat guidance is routed between compact blocks and on-demand workflows", () => {
  const components = listComponents();
  for (const id of appMeerkatBlockIds) {
    const component = components.find((candidate) => candidate.id === id);
    assert.equal(component.license, "Apache-2.0");
    assert.equal(component.content.upstream, "jmlero/app-meerkat");
    assert.equal(component.content.revision, "51b77a6a0506661979bef8c6b152d8b3d4fcc3ba");
  }
  const frontend = components.find(({ id }) => id === "skill/verify-frontend");
  assert.equal(frontend.context.loading, "on-demand");
  assert.equal(frontend.content.upstream, "jmlero/app-meerkat");
  assert.match(bundledContent(frontend), /representative narrow viewport/i);
  assert.match(bundledContent(components.find(({ id }) => id === "command/verify-work")), /CI failures/);
  assert.match(
    fs.readFileSync(path.join(repository, "THIRD_PARTY_NOTICES.md"), "utf8"),
    /jmlero\/app-meerkat/,
  );
});

test("workflow commands are complete, explicitly invoked Agent Skill packages", () => {
  for (const id of ["command/verify-work", "command/commit-work"]) {
    const component = listComponents().find((candidate) => candidate.id === id);
    assert.equal(component.context.loading, "explicit");
    const files = bundledPackage(component);
    assert.deepEqual(files.map(({ path: file }) => file), ["agents/openai.yaml", "SKILL.md"]);
    assert.match(files.find(({ path: file }) => file === "SKILL.md").content, /^---\nname: [a-z-]+\ndescription: .+\n---/);
    assert.match(files.find(({ path: file }) => file === "agents/openai.yaml").content, /allow_implicit_invocation: false/);
  }
});

test("Ponytail remains one compact attributed block without a duplicate skill", () => {
  const ponytail = listComponents().filter(({ id }) => id.includes("ponytail"));
  assert.deepEqual(ponytail.map(({ id }) => id), ["block/ponytail"]);
  assert.equal(ponytail[0].license, "MIT");
  assert.equal(ponytail[0].content.upstream, "DietrichGebert/ponytail");
  assert.match(ponytail[0].content.revision, /^[0-9a-f]{40}$/);
  assert.match(bundledContent(ponytail[0]), /smallest/i);
  assert.match(fs.readFileSync(path.join(repository, "THIRD_PARTY_NOTICES.md"), "utf8"), /DietrichGebert\/ponytail/);
});

test("portable components are vendor-neutral and integrations are Claude-only", () => {
  const components = listComponents();
  const portable = components.filter(isPortable);
  const claude = components.filter((component) => availableWithAdapters(component, ["claude"]));
  const grok = components.filter((component) => availableWithAdapters(component, ["grok"]));

  assert.ok(portable.some(({ id }) => id === "block/tdd"));
  assert.ok(portable.some(({ id }) => id === "skill/audit-code"));
  assert.ok(portable.every(({ kind }) => kind !== "plugin" && kind !== "hook"));
  assert.ok(portable.every((component) => component.adapters === undefined));
  assert.equal(claude.length, components.length);
  assert.equal(grok.length, portable.length);
  assert.equal(availableWithAdapters(components.find(({ id }) => id === "plugin/github"), []), false);
});

test("suggestions support prerequisite-aware AND and stack-aware OR rules", () => {
  const typescript = listComponents().find(({ id }) => id === "plugin/typescript-lsp");
  assert.equal(suggested(typescript, { hasTypeScript: true }).pick, false);
  assert.equal(suggested(typescript, {
    hasTypeScript: true,
    hasTypeScriptLanguageServer: true,
  }).pick, true);
  const frontend = listComponents().find(({ id }) => id === "skill/verify-frontend");
  assert.equal(suggested(frontend, { hasSvelte: true }).pick, true);
  assert.equal(suggested(frontend, {}).pick, false);
});

test("critical integration and block metadata is runtime-validated", () => {
  const plugin = listComponents().find(({ id }) => id === "plugin/github");
  assert.throws(
    () => validateCatalogComponent({ ...plugin, lastVerified: undefined }, new Set()),
    /lastVerified/,
  );
  const block = listComponents().find(({ id }) => id === "block/tdd");
  assert.throws(
    () => validateCatalogComponent({ ...block, alwaysOnJustification: "" }, new Set()),
    /alwaysOnJustification/,
  );
  assert.throws(
    () => validateCatalogComponent({ ...block, conflictsWith: [block.id] }, new Set()),
    /component conflicts/,
  );
  assert.deepEqual(catalogConflicts([
    { id: "block/one", conflictsWith: ["block/two"] },
    { id: "block/two" },
  ]), ["block/one <> block/two"]);
});

test("current marketplace mappings are explicit, verified, and non-overlapping", () => {
  const plugins = Object.fromEntries(listComponents()
    .filter(({ kind }) => kind === "plugin")
    .map((component) => [component.id, component]));
  assert.deepEqual(plugins["plugin/frontend-design"].adapter.claude, {
    pluginId: "frontend-design",
    marketplace: { name: "claude-plugins-official", repo: "anthropics/claude-plugins-official" },
  });
  assert.deepEqual(plugins["plugin/github"].adapter.claude, {
    pluginId: "github",
    marketplace: { name: "claude-plugins-official", repo: "anthropics/claude-plugins-official" },
  });
  assert.deepEqual(plugins["plugin/codex"].adapter.claude, {
    pluginId: "codex",
    marketplace: { name: "openai-codex", repo: "openai/codex-plugin-cc" },
  });
  assert.ok(Object.values(plugins).every(({ lastVerified }) => lastVerified === "2026-08-15"));
  assert.equal(plugins["plugin/terraform"], undefined);
  assert.equal(plugins["plugin/superpowers"], undefined);
});

test("remote skill directories are pinned, normalized, checksummed, and complete", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  const revision = "0123456789abcdef0123456789abcdef01234567";
  const treeSha = "89abcdef0123456789abcdef0123456789abcdef";
  const requested = [];
  globalThis.fetch = async (url) => {
    const value = String(url);
    requested.push(value);
    if (value.includes("/commits/")) {
      return { ok: true, json: async () => ({ sha: revision, commit: { tree: { sha: treeSha } } }) };
    }
    if (value.includes("/git/trees/")) {
      return {
        ok: true,
        json: async () => ({
          truncated: false,
          tree: [
            { path: "fastapi/.agents/skills/fastapi/SKILL.md", type: "blob", mode: "100644", size: 80 },
            { path: "fastapi/.agents/skills/fastapi/references/dependencies.md", type: "blob", mode: "100644", size: 20 },
            { path: "LICENSE", type: "blob", mode: "100644", size: 10 },
          ],
        }),
      };
    }
    if (value.endsWith("/SKILL.md")) {
      return { ok: true, text: async () => "---\r\nname: fastapi\r\ndescription: Remote skill.\r\n---\r\n\r\n# FastAPI\r\n" };
    }
    if (value.endsWith("/references/dependencies.md")) {
      return { ok: true, text: async () => "# Dependencies\r\n" };
    }
    if (value.endsWith("/LICENSE")) return { ok: true, text: async () => "MIT License\r\n" };
    return { ok: false, status: 404 };
  };
  const component = listComponents().find(({ id }) => id === "skill/fastapi");
  const resolved = await resolveRemotePackage(component);
  assert.deepEqual(resolved.files.map(({ path: file }) => file), [
    "LICENSE",
    "references/dependencies.md",
    "SKILL.md",
  ]);
  assert.match(resolved.files.find(({ path: file }) => file === "SKILL.md").content, /Project compatibility/);
  assert.equal(resolved.files.find(({ path: file }) => file === "references/dependencies.md").content, "# Dependencies\n");
  assert.equal(resolved.source.revision, revision);
  assert.equal(resolved.source.resolvedFiles.length, 3);
  assert.ok(resolved.source.resolvedFiles.every((file) => /^sha256-/.test(file.integrity)));
  assert.match(requested.find((url) => url.includes("/git/trees/")), new RegExp(treeSha));

  requested.length = 0;
  const locked = await lockedRemotePackage(component, resolved.source);
  assert.deepEqual(locked.files, resolved.files);
  assert.ok(requested.every((url) => url.startsWith("https://raw.githubusercontent.com/")));
  assert.equal(await lockedRemoteContent(component, resolved.source), await remoteContent(component));
});

test("Claude marketplace adapters package only canonical skills", () => {
  const marketplace = JSON.parse(fs.readFileSync(path.join(repository, ".claude-plugin", "marketplace.json"), "utf8"));
  assert.equal(marketplace.plugins.length, 3);
  for (const plugin of marketplace.plugins) {
    assert.equal(plugin.source, "./");
    assert.equal(plugin.strict, false);
    assert.equal(plugin.license, "Apache-2.0");
    assert.ok(plugin.skills.length > 0, plugin.name);
    for (const componentPath of plugin.skills) {
      assert.ok(fs.existsSync(path.resolve(repository, componentPath)), `${plugin.name}: ${componentPath}`);
    }
  }
});
