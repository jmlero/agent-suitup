#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import { stdout as output } from "node:process";
import {
  availableWithAdapters,
  getComponent,
  listComponents,
  requireComponent,
  suggested,
} from "../src/catalog.mjs";
import { agentNames, agents, detectAgents } from "../src/agents.mjs";
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
  formatAgentChoices,
  formatApprovalPrompt,
  formatListHeader,
  formatNotes,
  formatProgress,
  formatProjectScan,
  formatScopeChoice,
  formatSelection,
  formatSetupStep,
  orderedComponents,
  sectionKind,
} from "../src/ui.mjs";

const { version } = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));

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
  const detectedAgents = detectAgents({ cwd });
  const catalog = listComponents();
  const installedIds = new Set(existing?.components.map(({ id }) => id) ?? []);
  maybeBanner("Set up rules, skills, and skill commands for your coding agents.");
  console.log(formatProjectScan({
    cwd, stack: humanSummary(detected), agents: agentNames([...detectedAgents]), catalogSize: catalog.length,
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
    const adapters = await chooseAgents(prompt, flags, existing, detectedAgents);
    console.log(`\n${formatSetupStep(2)}`);
    const { ids: selectedIds, scope } = await chooseComponents(prompt,
      catalog.filter((component) => availableWithAdapters(component, adapters)), detected, installedIds, {
        scope: flags.scope ?? "project", adapters,
        installedScopes: new Map(existing?.components.map(({ id, scope }) => [id, scope]) ?? []),
      });
    if (!selectedIds.length) {
      console.log("No new components selected. Repository left unchanged.");
      return;
    }
    const components = selectedIds.map((id) => requireComponent(id));
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
      displayComponents: components, action: "agent-suitup ready", suggestMore: true, prompt,
    });
  } finally {
    prompt.close();
  }
}

async function add({ cwd, home, flags, values }) {
  const existing = readManifest(cwd);
  const detected = detectStack(cwd);
  let selectedIds = values;
  let interactiveScope = null;
  let interactiveAdapters = null;
  let prompt;
  maybeBanner("Add rules, skills, and skill commands for your coding agents.");

  try {
    if (!selectedIds.length) {
      if (!process.stdin.isTTY && !flags.interactive) {
        throw new Error("Usage: agent-suitup add <component> [component...] or add --interactive");
      }
      const installedIds = new Set(existing?.components.map(({ id }) => id) ?? []);
      prompt = new Prompts({ plain: flags.plain });
      interactiveAdapters = await chooseAgents(prompt, flags, existing, detectAgents({ cwd }));
      console.log(`\n${formatSetupStep(2)}`);
      const candidates = listComponents().filter((component) => availableWithAdapters(component, interactiveAdapters));
      ({ ids: selectedIds, scope: interactiveScope } = await chooseComponents(prompt, candidates, detected, installedIds, {
        scope: flags.scope ?? "project", adapters: interactiveAdapters,
        installedScopes: new Map(existing?.components.map(({ id, scope }) => [id, scope]) ?? []),
      }));
      if (!selectedIds.length) {
        console.log("No new components selected. Repository left unchanged.");
        return;
      }
      console.log(`\n${formatSetupStep(3)}`);
    }

    const components = selectedIds.map((id) => requireComponent(id));
    const adapters = interactiveAdapters
      ?? enableRequiredAdapters(withAdapters(existing, flags.adapters), components, flags.adapters);
    const byId = new Map((existing?.components ?? []).map((selection) => [selection.id, selection]));
    for (const component of components) {
      const { id } = component;
      byId.set(id, {
        id,
        // The picker starts from --scope, so its choice is the final one.
        scope: interactiveScope ? componentScope(component, interactiveScope)
          : flags.scope ?? byId.get(id)?.scope ?? componentScope(component, null),
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
  if (!values.length && flags.adapters === null) {
    throw new Error("Usage: agent-suitup remove <component> [component...] or remove --agent <agent>");
  }
  const existing = readManifest(cwd, { required: true });
  const installed = new Set(existing.components.map(({ id }) => id));
  const missing = values.filter((id) => !installed.has(id));
  if (missing.length) throw new Error(`Not installed: ${missing.join(", ")}`);
  const removed = new Set(values);
  const components = existing.components.filter(({ id }) => !removed.has(id));
  const adapters = flags.adapters === null ? existing.adapters : removeAdapters(existing, components, flags.adapters);
  const manifest = normalizeManifest({ ...existing, adapters, components });
  await applyDesired({
    cwd,
    home,
    manifest,
    flags,
    writeManifest: true,
    displayComponents: values.map((id) => getComponent(id)).filter(Boolean),
    action: values.length ? "Components removed" : "Agents removed",
  });
}

function removeAdapters(existing, components, dropped) {
  if (!dropped.length) throw new Error("remove --agent needs claude, codex, grok, or a comma-separated list");
  const disabled = dropped.filter((adapter) => !existing.adapters.includes(adapter));
  if (disabled.length) throw new Error(`Agent not set up: ${disabled.join(", ")}`);
  const adapters = existing.adapters.filter((adapter) => !dropped.includes(adapter));
  const dependents = components.map(({ id }) => getComponent(id))
    .filter((component) => component?.adapters && !component.adapters.some((adapter) => adapters.includes(adapter)));
  if (dependents.length) {
    const ids = dependents.map(({ id }) => id).join(", ");
    const required = agentNames([...new Set(dependents.flatMap((component) => component.adapters))]).join(" or ");
    const one = dependents.length === 1;
    throw new Error(`${ids} still require${one ? "s" : ""} ${required}; remove ${one ? "it" : "them"} first or in the same command`);
  }
  return adapters;
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
    action: "agent-suitup updated",
  });
}

async function doctor({ cwd, home, flags }) {
  const manifest = readManifest(cwd, { required: true });
  const previousLock = readLock(cwd);
  const result = await reconcile({ cwd, home, manifest, previousLock, force: false });
  const lockMatches = jsonDocument(previousLock) === jsonDocument(result.lock);
  const drift = result.planner.hasChanges() || !lockMatches;
  if (!drift && !result.missingPrerequisites.length) {
    console.log(formatHealthy(manifest.components.length));
    if (result.planner.notes.length) console.log(`\n${formatNotes(result.planner.notes)}`);
    return;
  }

  console.error(drift
    ? "Drift or an available catalog update was detected:"
    : "Installed components are missing required commands:");
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
  suggestMore = false,
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
      const answer = (await prompt.question(formatApprovalPrompt())).trim().toLowerCase();
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
  console.log(formatApplySummary(result.planner, {
    components: displayComponents, action, reviewed: Boolean(prompt), suggestMore, adapters: manifest.adapters,
  }));
}

function componentScope(component, requested) {
  if (component.scopes.includes(requested)) return requested;
  if (component.recommendedScope && component.scopes.includes(component.recommendedScope)) {
    return component.recommendedScope;
  }
  return component.scopes[0];
}

// Setup only adds agents: existing ones stay, and remove --adapter drops one.
async function chooseAgents(prompt, flags, existing, detected) {
  const current = existing?.adapters ?? [];
  if (flags.adapters !== null) return withAdapters(existing, flags.adapters);
  console.log(`\n${formatSetupStep(1)}`);
  let chosen;
  if (prompt.canPick()) chosen = await prompt.pickAgents({ enabled: current, detected });
  else {
    console.log(formatAgentChoices(detected, current));
    while (!chosen) {
      const answer = await prompt.question("Your agents (all, or numbers or names, e.g. 1,3) [all]: ");
      try {
        chosen = parseAgentChoice(answer);
      } catch (error) {
        console.log(error.message);
      }
    }
  }
  const enabled = withAdapters(existing, chosen);
  console.log(`Agents: ${agentNames(enabled).join(", ")}`);
  return enabled;
}

function parseAgentChoice(answer) {
  const value = answer.trim().toLowerCase().replace(/claude code/g, "claude").replace(/grok build/g, "grok");
  if (!value || value === "all") return agents.map(({ id }) => id);
  const chosen = new Set();
  for (const token of value.split(/[\s,]+/).filter(Boolean)) {
    const agent = agents[Number(token) - 1] ?? agents.find(({ id }) => id === token);
    if (!agent) throw new Error(`Unknown agent: ${token}. Use 1-${agents.length}, ${agents.map(({ id }) => id).join(", ")}, or all.`);
    chosen.add(agent.id);
  }
  return [...chosen];
}

async function chooseComponents(prompt, components, detected, installedIds = new Set(), options = {}) {
  const ordered = orderedComponents(components);
  if (prompt.canPick()) return prompt.pick(ordered, {
    ...options, installedIds, suggest: (component) => suggested(component, detected),
  });
  console.log("\nChoose blocks, skills, skill commands, and integrations. No item is preselected.\n");
  console.log(formatCatalog(ordered, { detected, installedIds, numbered: true, suggest: suggested }));
  console.log('\nUse numbers, ranges (1,3-5), component IDs, groups (blocks, skills, commands, integrations), all, or none. Enter skips.');
  console.log('Type i <number or ID> to read its full guide before choosing. Installed items are kept.');
  let { scope } = options;
  const scopable = ordered.some((component) => component.scopes.includes("user"));
  if (scopable) console.log(formatScopeChoice(scope));
  while (true) {
    const answer = await prompt.question('Select numbers or ranges [none]: ');
    try {
      if (scopable && answer.trim().toLowerCase() === "u") {
        scope = scope === "user" ? "project" : "user";
        console.log(formatScopeChoice(scope));
        continue;
      }
      const inspect = /^i\s+(.+)$/i.exec(answer.trim());
      if (inspect) {
        const ids = parseSelection(inspect[1], ordered);
        if (ids.length !== 1) { console.log("Inspect one component number or ID at a time."); continue; }
        console.log(`\n${formatComponentGuide(requireComponent(ids[0]), {
          ...options, scope: options.installedScopes?.get(ids[0]) ?? scope,
        })}\n`);
        continue;
      }
      return { ids: parseSelection(answer, ordered).filter((id) => !installedIds.has(id)), scope };
    } catch (error) {
      console.log(error.message);
    }
  }
}

// Installing only adds agents; remove --agent is the explicit way to drop one.
// A new project sets up every agent unless --agent narrows it.
function withAdapters(existing, requested) {
  const current = existing?.adapters ?? (requested === null ? agents.map(({ id }) => id) : []);
  return [...new Set([...current, ...(requested ?? [])])];
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
    else if (value === "--scope" || agentFlags.has(value)) {
      const next = argv[index + 1];
      if (!next || next.startsWith("-")) throw new Error(`${value} requires a value`);
      index += 1;
      setValueFlag(flags, value, next);
    } else if (value.startsWith("--scope=")) setValueFlag(flags, "--scope", value.slice(8));
    else if (agentFlags.has(value.split("=")[0]) && value.includes("=")) setValueFlag(flags, "--agent", value.slice(value.indexOf("=") + 1));
    else if (value.startsWith("-")) throw new Error(`Unknown flag: ${value}`);
    else if (!command) command = value;
    else values.push(value);
  }

  return { command: command ?? "init", flags, values };
}

// --agent is the documented name; --adapter predates it and stays accepted.
const agentFlags = new Set(["--agent", "--agents", "--adapter", "--adapters"]);

function setValueFlag(flags, name, value) {
  if (name === "--scope") {
    if (!new Set(["project", "user"]).has(value)) throw new Error(`Invalid scope: ${value}`);
    flags.scope = value;
    return;
  }
  flags.adapters = parseAdapters(value);
}

function parseAdapters(value) {
  if (value.trim() === "none") return [];
  const adapters = value.split(",").map((adapter) => adapter.trim()).filter(Boolean);
  if (!adapters.length || adapters.some((adapter) => !supportedAdapters.includes(adapter))) {
    throw new Error(`Invalid agents: ${value}. Use claude, codex, grok, a comma-separated list, or none.`);
  }
  return [...new Set(adapters)];
}

function printHelp() {
  console.log(`agent-suitup ${version}

Usage:
  agent-suitup init [--interactive|--yes] [--agent claude,codex,grok]
  agent-suitup list [blocks|skills|commands|integrations]
  agent-suitup inspect <component>
  agent-suitup add [component...] [--scope project|user] [--agent claude,codex,grok]
  agent-suitup plan
  agent-suitup remove <component...> [--agent claude,codex,grok]
  agent-suitup remove --agent claude|codex|grok
  agent-suitup update
  agent-suitup doctor

Options:
  -y, --yes       For init, assess without changing project or user files
  --interactive   Prompt even when standard input is piped
  --plain         Use numbered prompts instead of the keyboard picker
  --dry-run       Print exact changes without writing
  --force         Replace drifted managed content
  --scope VALUE   Default project or user scope
  --agent VALUE   Coding agents: claude, codex, grok, a comma-separated list,
                  or none (alias --adapter); init and add only add agents,
                  remove --agent drops one
  -h, --help      Show help
  --version       Show version

Where content goes:
  blocks        .agents/rules.md, linked from AGENTS.md by one managed line
  skills        .agents/skills (Codex, Grok Build); Claude Code gets a link
                in .claude/skills
  commands      Skill commands: skills that run only when you invoke them,
                /name in Claude Code and Grok Build, $name in Codex
  integrations  Claude Code plugins enabled in .claude/settings.json

Run init to choose your agents (all three by default), pick from the catalog,
and review the files. Without --agent, add sets up all three in a new project.
In the picker: ↑/↓ move, Space selects, Tab, Shift+Tab, ←/→, or 1-5 switch
categories, i expands the details, / searches, s shows your selection, and
Enter continues. No catalog item is preselected.
Use --plain for numbered prompts. Ctrl+C cancels without writing.
Esc clears a filter or exits the picker.
Use inspect <component> for a read-only guide with the exact text it adds.
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
