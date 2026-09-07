#!/usr/bin/env node
import os from "node:os";
import { stdout as output } from "node:process";
import {
  availableWithAdapters,
  getComponent,
  listComponents,
  requireComponent,
  suggested,
} from "../src/catalog.mjs";
import { detectStack, humanSummary } from "../src/detect.mjs";
import { formatPlan } from "../src/planner.mjs";
import { Prompts, PromptCancelled, parseSelection } from "../src/prompts.mjs";
import { reconcile } from "../src/reconcile.mjs";
import {
  emptyManifest,
  jsonDocument,
  normalizeManifest,
  readLock,
  readManifest,
  statePaths,
  supportedAdapters,
} from "../src/state.mjs";
import {
  formatApplySummary,
  formatBanner,
  formatCatalog,
  formatComponentGuide,
  formatDryRunFooter,
  formatHealthy,
  formatInstallReview,
  formatListHeader,
  formatProgress,
  formatProjectScan,
  formatSelection,
  formatSetupStep,
  orderedComponents,
  sectionKind,
} from "../src/ui.mjs";

const version = "0.1.0";

async function main() {
  const parsed = parseArguments(process.argv.slice(2));
  if (parsed.flags.help) return printHelp();
  if (parsed.flags.version) return console.log(version);

  const cwd = process.cwd();
  const home = os.homedir();
  switch (parsed.command) {
    case "init":
      await initialize({ cwd, home, ...parsed });
      break;
    case "inspect":
      if (parsed.values.length !== 1) throw new Error("Usage: agent-suitup inspect <component>");
      console.log(formatComponentGuide(requireComponent(parsed.values[0]), {
        scope: parsed.flags.scope ?? "project", adapters: parsed.flags.adapters ?? [],
      }));
      break;
    case "add":
      await add({ cwd, home, ...parsed });
      break;
    case "remove":
      await remove({ cwd, home, ...parsed });
      break;
    case "plan":
      await plan({ cwd, home, ...parsed });
      break;
    case "update":
      await update({ cwd, home, ...parsed });
      break;
    case "doctor":
      await doctor({ cwd, home, ...parsed });
      break;
    case "list":
      list({ cwd, ...parsed });
      break;
    default:
      throw new Error(`Unknown command: ${parsed.command}`);
  }
}

async function initialize({ cwd, home, flags }) {
  const existing = readManifest(cwd);
  const detected = detectStack(cwd);
  const catalog = listComponents();
  const installedIds = new Set(existing?.components.map(({ id }) => id) ?? []);
  maybeBanner("Build your toolkit: skills, working agreements, and integrations.");
  console.log(formatProjectScan({
    cwd, stack: humanSummary(detected), catalogSize: catalog.length,
    suggestedCount: catalog.filter((component) => suggested(component, detected).pick).length,
    installedCount: installedIds.size,
  }));
  if (flags.yes) {
    console.log(`${formatProgress("Assessment complete")} · no components installed automatically`);
    console.log("Repository left unchanged.");
    return;
  }
  if (!process.stdin.isTTY && !flags.interactive) {
    throw new Error("Interactive init needs a terminal; use --yes, --interactive, or add components explicitly");
  }
  const prompt = new Prompts({ plain: flags.plain });
  try {
    console.log(`\n${formatSetupStep(1)}`);
    const candidates = flags.adapters === null ? catalog
      : catalog.filter((component) => availableWithAdapters(component, flags.adapters));
    const selectedIds = await chooseComponents(prompt, candidates, detected, installedIds, {
      scope: flags.scope ?? "project", adapters: flags.adapters ?? existing?.adapters ?? [],
      installedScopes: new Map(existing?.components.map(({ id, scope }) => [id, scope]) ?? []),
    });
    if (!selectedIds.length) {
      console.log("No new components selected. Repository left unchanged.");
      return;
    }
    const components = selectedIds.map((id) => requireComponent(id));
    console.log(`\n${formatSelection(components)}\n\n${formatSetupStep(2)}`);
    const adapters = await chooseAdapters(prompt, flags, existing, components);
    const scope = flags.scope ?? (components.some((component) => component.scopes.length > 1)
      ? await chooseScope(prompt, "project") : "project");
    const byId = new Map((existing?.components ?? []).map((selection) => [selection.id, selection]));
    for (const component of components) {
      byId.set(component.id, { id: component.id, scope: componentScope(component, scope) });
    }
    const manifest = normalizeManifest({
      ...(existing ?? emptyManifest()), adapters, components: [...byId.values()],
    });
    console.log(`\n${formatSetupStep(3)}`);
    await applyDesired({
      cwd, home, manifest, flags, writeManifest: true,
      displayComponents: components, action: "Agent Suitup ready", prompt,
    });
  } finally {
    prompt.close();
  }
}

async function add({ cwd, home, flags, values }) {
  const existing = readManifest(cwd);
  const detected = detectStack(cwd);
  let selectedIds = values;
  let interactiveDefaultScope = null;
  let interactiveAdapters = null;
  let prompt;
  maybeBanner("Add one explicit capability to agent-suitup.");

  try {
    if (!selectedIds.length) {
      if (!process.stdin.isTTY && !flags.interactive) {
        throw new Error("Usage: agent-suitup add <component> [component...] or add --interactive");
      }
      const adapters = flags.adapters ?? existing?.adapters ?? [];
      const installedIds = new Set(existing?.components.map(({ id }) => id) ?? []);
      const candidates = flags.adapters === null
        ? listComponents()
        : listComponents().filter((component) => availableWithAdapters(component, adapters));
      if (!candidates.length) {
        console.log("No components available for the selected adapters.");
        return;
      }
      prompt = new Prompts({ plain: flags.plain });
      console.log(`\n${formatSetupStep(1)}`);
      selectedIds = await chooseComponents(prompt, candidates, detected, installedIds, {
        scope: flags.scope ?? "project", adapters,
        installedScopes: new Map(existing?.components.map(({ id, scope }) => [id, scope]) ?? []),
      });
      if (!selectedIds.length) {
        console.log("No new components selected. Repository left unchanged.");
        return;
      }
      console.log(`\n${formatSetupStep(2)}`);
      interactiveAdapters = await chooseAdapters(prompt, flags, existing, selectedIds.map(requireComponent));
      if (!flags.scope && selectedIds.some((id) => requireComponent(id).scopes.length > 1)) {
        interactiveDefaultScope = await chooseScope(prompt, "project");
      }
      console.log(`\n${formatSetupStep(3)}`);
    }

    const components = selectedIds.map((id) => requireComponent(id));
    const adapters = interactiveAdapters ?? enableRequiredAdapters(flags.adapters ?? [...(existing?.adapters ?? [])], components, flags.adapters);
    const byId = new Map((existing?.components ?? []).map((selection) => [selection.id, selection]));
    for (const component of components) {
      const { id } = component;
      byId.set(id, {
        id,
        scope: flags.scope ?? byId.get(id)?.scope ?? componentScope(component, interactiveDefaultScope),
      });
    }
    const manifest = normalizeManifest({
      ...(existing ?? emptyManifest()),
      adapters,
      components: [...byId.values()],
    });
    await applyDesired({
      cwd,
      home,
      manifest,
      flags,
      writeManifest: true,
      displayComponents: components,
      action: "Components added",
      prompt,
    });
  } finally {
    prompt?.close();
  }
}

async function remove({ cwd, home, flags, values }) {
  if (!values.length) throw new Error("Usage: agent-suitup remove <component> [component...]");
  const existing = readManifest(cwd, { required: true });
  const installed = new Set(existing.components.map(({ id }) => id));
  const missing = values.filter((id) => !installed.has(id));
  if (missing.length) throw new Error(`Not installed: ${missing.join(", ")}`);
  const removed = new Set(values);
  const manifest = normalizeManifest({
    ...existing,
    components: existing.components.filter(({ id }) => !removed.has(id)),
  });
  await applyDesired({
    cwd,
    home,
    manifest,
    flags,
    writeManifest: true,
    displayComponents: values.map((id) => getComponent(id)).filter(Boolean),
    action: "Components removed",
  });
}

async function plan({ cwd, home, flags }) {
  const manifest = readManifest(cwd, { required: true });
  const previousLock = readLock(cwd);
  const result = await reconcile({ cwd, home, manifest, previousLock, force: flags.force });
  const paths = statePaths(cwd);
  result.planner.write(paths.lock, jsonDocument(result.lock), { allowExisting: true });
  const components = manifest.components.map(({ id }) => requireComponent(id));
  if (components.some(({ kind }) => kind === "block")) {
    console.log(formatSelection(components));
    console.log("");
  }
  console.log(formatPlan(result.planner));
}

async function update({ cwd, home, flags }) {
  const manifest = readManifest(cwd, { required: true });
  await applyDesired({
    cwd,
    home,
    manifest,
    flags,
    writeManifest: false,
    refreshRemote: true,
    displayComponents: manifest.components.map(({ id }) => requireComponent(id)),
    action: "Agent Suitup updated",
  });
}

async function doctor({ cwd, home, flags }) {
  const manifest = readManifest(cwd, { required: true });
  const previousLock = readLock(cwd);
  const result = await reconcile({ cwd, home, manifest, previousLock, force: false });
  const lockMatches = jsonDocument(previousLock) === jsonDocument(result.lock);
  if (!result.planner.hasChanges() && lockMatches) {
    console.log(formatHealthy(manifest.components.length, result.planner.notes.length > 0));
    return;
  }

  console.error("Drift or an available catalog update was detected:");
  console.error(formatPlan(result.planner));
  if (!lockMatches) console.error("Lockfile metadata differs from the catalog or manifest.");
  process.exitCode = 1;
}

function list({ cwd, flags, values }) {
  if (values.length > 1) throw new Error("Usage: agent-suitup list [section]");
  const filter = sectionKind(values[0]);
  const manifest = readManifest(cwd);
  const installedIds = new Set(manifest?.components.map(({ id }) => id) ?? []);
  const detected = detectStack(cwd);
  let components = listComponents().filter((component) => flags.adapters === null
    || availableWithAdapters(component, flags.adapters));
  if (filter) components = components.filter(({ kind }) => kind === filter);
  maybeBanner("Browse the curated component catalog.");
  console.log(formatListHeader(components.length, components.filter(({ id }) => installedIds.has(id)).length, filter));
  console.log("");
  console.log(formatCatalog(components, { detected, installedIds, suggest: suggested }));
}

async function applyDesired({
  cwd,
  home,
  manifest,
  flags,
  writeManifest,
  refreshRemote = false,
  displayComponents = [],
  action = "Applied",
  prompt,
}) {
  if (output.isTTY) console.log(formatProgress("Preparing your setup…"));
  const previousLock = readLock(cwd);
  const result = await reconcile({
    cwd,
    home,
    manifest,
    previousLock,
    force: flags.force,
    refreshRemote,
  });
  const paths = statePaths(cwd);
  if (writeManifest) result.planner.write(paths.manifest, jsonDocument(manifest), { allowExisting: true });
  result.planner.write(paths.lock, jsonDocument(result.lock), { allowExisting: true });

  if (flags.dryRun) {
    const components = manifest.components.map(({ id }) => requireComponent(id));
    if (components.some(({ kind }) => kind === "block")) {
      console.log(formatSelection(components));
      console.log("");
    }
    console.log(formatPlan(result.planner));
    console.log("");
    console.log(formatDryRunFooter());
    return;
  }
  if (prompt) {
    console.log(`\n${formatInstallReview(result.planner, manifest, displayComponents)}\n`);
    while (true) {
      const answer = (await prompt.question("Install this selection? [Y/n/p preview]: ")).trim().toLowerCase();
      if (!answer || answer === "y" || answer === "yes") break;
      if (answer === "n" || answer === "no") {
        console.log("Installation cancelled. No files written.");
        return;
      }
      if (answer === "p" || answer === "preview") console.log(`\n${formatPlan(result.planner)}\n`);
      else console.log("Use Enter to install, n to cancel, or p to preview exact changes.");
    }
  }
  result.planner.apply();
  console.log(formatApplySummary(result.planner, { components: displayComponents, action, reviewed: Boolean(prompt) }));
}

function componentScope(component, requested) {
  if (component.scopes.includes(requested)) return requested;
  if (component.recommendedScope && component.scopes.includes(component.recommendedScope)) {
    return component.recommendedScope;
  }
  return component.scopes[0];
}

async function chooseScope(prompt, fallback) {
  console.log("Project keeps content in this repository; user makes it available across projects.");
  while (true) {
    const answer = await prompt.question(`Default scope: project or user [${fallback}]: `);
    const scope = answer.trim().toLowerCase() || fallback;
    if (new Set(["project", "user"]).has(scope)) return scope;
    console.log(`Invalid scope: ${scope}. Use project or user.`);
  }
}

async function chooseAdapters(prompt, flags, existing, components) {
  const adapters = enableRequiredAdapters(flags.adapters ?? existing?.adapters ?? [], components, flags.adapters);
  if (flags.adapters !== null || components.every(({ kind }) => kind === "plugin")) return adapters;
  const fallback = adapters.length === 2 ? "both" : adapters[0] ?? "portable";
  console.log("Portable: canonical instructions and skills. Claude: add its bridges. Grok: add command wrappers.");
  const choices = { portable: [], claude: ["claude"], grok: ["grok"], both: ["claude", "grok"] };
  while (true) {
    const answer = (await prompt.question(`Agent setup: portable, claude, grok, or both [${fallback}]: `)).trim().toLowerCase() || fallback;
    if (!Object.hasOwn(choices, answer)) { console.log("Choose portable, claude, grok, or both."); continue; }
    const chosen = choices[answer];
    // Init adds capabilities; it does not remove adapters from an existing setup.
    const enabled = [...new Set([...adapters, ...chosen])];
    if (enabled.length) console.log(`Enabled adapters: ${enabled.join(", ")}. Existing and required adapters are kept.`);
    return enabled;
  }
}

async function chooseComponents(prompt, components, detected, installedIds = new Set(), options = {}) {
  const ordered = orderedComponents(components);
  if (prompt.canPick()) return prompt.pick(ordered, {
    ...options, installedIds, suggest: (component) => suggested(component, detected),
  });
  console.log("\nExplore skills, blocks, commands, and integrations. Nothing is preselected.\n");
  console.log(formatCatalog(ordered, { detected, installedIds, numbered: true, suggest: suggested }));
  console.log('\nUse numbers, ranges (1,3-5), component IDs, all, or none. Enter skips.');
  console.log('Type i <number or ID> to read its full guide before choosing. Installed items are kept.');
  while (true) {
    const answer = await prompt.question('Select numbers or ranges [none]: ');
    try {
      const inspect = /^i\s+(.+)$/i.exec(answer.trim());
      if (inspect) {
        const ids = parseSelection(inspect[1], ordered);
        if (ids.length !== 1) { console.log("Inspect one component number or ID at a time."); continue; }
        console.log(`\n${formatComponentGuide(requireComponent(ids[0]), {
          ...options, scope: options.installedScopes?.get(ids[0]) ?? options.scope,
        })}\n`);
        continue;
      }
      return parseSelection(answer, ordered).filter((id) => !installedIds.has(id));
    } catch (error) {
      console.log(error.message);
    }
  }
}

function enableRequiredAdapters(adapters, components, explicitAdapters) {
  const enabled = [...adapters];
  if (explicitAdapters !== null) return enabled;
  for (const component of components) {
    if (component.adapters?.length
      && !component.adapters.some((adapter) => enabled.includes(adapter))) {
      enabled.push(component.adapters[0]);
    }
  }
  return enabled;
}

function maybeBanner(subtitle) {
  if (output.isTTY) console.log(formatBanner(subtitle));
}

function parseArguments(argv) {
  const flags = {
    dryRun: false,
    force: false,
    help: false,
    interactive: false,
    plain: false,
    scope: null,
    adapters: null,
    version: false,
    yes: false,
  };
  const values = [];
  let command = null;

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "-h" || value === "--help") flags.help = true;
    else if (value === "--version") flags.version = true;
    else if (value === "-y" || value === "--yes") flags.yes = true;
    else if (value === "--interactive") flags.interactive = true;
    else if (value === "--plain") flags.plain = true;
    else if (value === "--dry-run") flags.dryRun = true;
    else if (value === "--force") flags.force = true;
    else if (value === "--scope" || value === "--adapter" || value === "--adapters"
      || value === "--target" || value === "--targets") {
      const next = argv[index + 1];
      if (!next || next.startsWith("-")) throw new Error(`${value} requires a value`);
      index += 1;
      setValueFlag(flags, value, next);
    } else if (value.startsWith("--scope=")) setValueFlag(flags, "--scope", value.slice(8));
    else if (value.startsWith("--adapter=")) setValueFlag(flags, "--adapter", value.slice(10));
    else if (value.startsWith("--adapters=")) setValueFlag(flags, "--adapters", value.slice(11));
    else if (value.startsWith("--target=")) setValueFlag(flags, "--target", value.slice(9));
    else if (value.startsWith("--targets=")) setValueFlag(flags, "--targets", value.slice(10));
    else if (value.startsWith("-")) throw new Error(`Unknown flag: ${value}`);
    else if (!command) command = value;
    else values.push(value);
  }

  return { command: command ?? "init", flags, values };
}

function setValueFlag(flags, name, value) {
  if (name === "--scope") {
    if (!new Set(["project", "user"]).has(value)) throw new Error(`Invalid scope: ${value}`);
    flags.scope = value;
    return;
  }
  flags.adapters = name === "--target" || name === "--targets"
    ? parseLegacyTargets(value)
    : parseAdapters(value);
}

function parseAdapters(value) {
  if (value.trim() === "none") return [];
  const adapters = value.split(",").map((adapter) => adapter.trim()).filter(Boolean);
  if (!adapters.length || adapters.some((adapter) => !supportedAdapters.includes(adapter))) {
    throw new Error(`Invalid adapters: ${value}`);
  }
  return [...new Set(adapters)];
}

function parseLegacyTargets(value) {
  const targets = value.split(",").map((target) => target.trim()).filter(Boolean);
  if (!targets.length || targets.some((target) => !new Set(["claude", "codex"]).has(target))) {
    throw new Error(`Invalid legacy targets: ${value}`);
  }
  return targets.includes("claude") ? ["claude"] : [];
}

function printHelp() {
  console.log(`agent-suitup ${version}

Usage:
  agent-suitup init [--interactive|--yes] [--adapter claude|grok]
  agent-suitup list [blocks|skills|commands|integrations]
  agent-suitup inspect <component>
  agent-suitup add [component...] [--scope project|user] [--adapter claude|grok]
  agent-suitup plan
  agent-suitup remove <component...>
  agent-suitup update
  agent-suitup doctor

Options:
  -y, --yes       For init, assess without changing project or user files
  --interactive   Prompt even when standard input is piped
  --plain         Use numbered prompts instead of the keyboard picker
  --dry-run       Print exact changes without writing
  --force         Replace drifted managed content
  --scope VALUE   Default project or user scope
  --adapter VALUE Optional vendor adapter: claude, grok, or none
  -h, --help      Show help
  --version       Show version

Portable content installs canonically for every agent. Codex and Grok read the
canonical files directly; adapters add only vendor-specific edges.

Run init to explore the full catalog, connect your agent, and review.
Tab or 1-5 switches categories; arrows browse; Space selects; i opens a full
guide; / searches; s shows your selection; Enter continues. Nothing is preselected.
Use --plain for numbered prompts. Ctrl+C cancels without writing.
Esc clears a filter or exits the picker.
init and add --interactive open the same control panel, including skills.
Use inspect <component> for a read-only guide with examples and install paths.

Component sections:
  blocks        Always-on text managed inside AGENTS.md
  skills        On-demand knowledge and workflows
  commands      Explicit Agent Skills invoked as $name in Codex or /name in Grok
  integrations  Vendor-native plugins and language servers
`);
}

main().catch((error) => {
  if (error instanceof PromptCancelled) {
    console.log(`\n${error.message}`);
    process.exitCode = 130;
    return;
  }
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
