import { agentNames, agents, allAgentsSummary } from "./agents.mjs";
import { aggregateContextCost, componentContextCost, requireComponent } from "./catalog.mjs";
import { componentGuide, componentKinds, invocations } from "./component-guide.mjs";

const sections = ["block", "skill", "command", "plugin"]
  .map((kind) => ({ kind, title: componentKinds[kind].plural, description: componentKinds[kind].about }));

const sectionAliases = new Map([
  ["block", "block"],
  ["blocks", "block"],
  ["instruction", "block"],
  ["instructions", "block"],
  ["skill", "skill"],
  ["skills", "skill"],
  ["command", "command"],
  ["commands", "command"],
  ["skill-command", "command"],
  ["skill-commands", "command"],
  ["plugin", "plugin"],
  ["plugins", "plugin"],
  ["integration", "plugin"],
  ["integrations", "plugin"],
]);

export function sectionAlias(value) {
  return sectionAliases.get(value.toLowerCase());
}

export function sectionKind(value) {
  if (!value || value === "all") return null;
  const kind = sectionAlias(value);
  if (!kind) {
    throw new Error(`Unknown section: ${value}. Use blocks, skills, commands, or integrations.`);
  }
  return kind;
}

export function orderedComponents(components) {
  const rank = new Map(sections.map((section, index) => [section.kind, index]));
  return components
    .map((component, index) => ({ component, index }))
    .sort((left, right) => (rank.get(left.component.kind) ?? sections.length)
      - (rank.get(right.component.kind) ?? sections.length)
      || left.index - right.index)
    .map(({ component }) => component);
}

export function formatBanner(subtitle = "Set up rules, skills, and skill commands for your coding agents.") {
  return `\n${paint("1", "agent-suitup")}  ${paint("2", subtitle)}\n`;
}

export function formatProjectScan({ cwd, stack, agents: detected = [], catalogSize, suggestedCount, installedCount = 0 }) {
  return formatStage("Project", [
    paint("2", cwd),
    `Stack    ${stack.length ? stack.join(paint("2", " · ")) : paint("2", "No specific stack detected")}`,
    `Agents   ${detected.length ? `${detected.join(", ")} ${paint("2", "detected")}` : paint("2", "None detected")}`,
    `Catalog  ${catalogSize} items · ${suggestedCount} suggested${installedCount ? ` · ${installedCount} installed` : ""}`,
  ]);
}

export function formatAgentChoices(detected = new Set(), enabled = []) {
  const width = Math.max(...agents.map(({ name }) => name.length)) + 2;
  return [
    paint("1", "Which coding agents do you use?"),
    paint("2", "Every agent reads AGENTS.md. Skills and skill commands are installed where each agent looks for them."),
    `  all  ${"All agents".padEnd(width)}${paint("2", allAgentsSummary)}`,
    ...agents.map((agent, index) => {
      const tag = enabled.includes(agent.id) ? "set up, kept" : detected.has(agent.id) ? "detected" : "";
      return `  ${String(index + 1).padEnd(3)}  ${agent.name.padEnd(width)}${paint("2", agent.setup)}${tag ? `  ${paint("32", tag)}` : ""}`;
    }),
  ].join("\n");
}

export function formatCatalog(components, {
  detected = {},
  installedIds = new Set(),
  numbered = false,
  suggest = () => ({ pick: false }),
} = {}) {
  const ordered = orderedComponents(components);
  const indexes = new Map(ordered.map((component, index) => [component.id, index + 1]));
  const output = [];

  for (const section of sections) {
    const items = ordered.filter((component) => component.kind === section.kind);
    if (!items.length) continue;
    output.push(`${paint("1;36", "◆")} ${paint("1", section.title)} ${paint("2", `(${items.length})`)}`);
    output.push(`  ${paint("2", section.description)}`);
    output.push("");
    for (const component of items) {
      const recommendation = suggest(component, detected);
      const installed = installedIds.has(component.id);
      const marker = installed ? paint("32", "✓") : recommendation.pick ? paint("33", "★") : paint("2", "·");
      const number = numbered ? `${String(indexes.get(component.id)).padStart(2, "0")} ` : "";
      const state = installed ? paint("32", " installed") : "";
      output.push(`  ${number}${marker} ${paint("1", component.id)}  ${component.name}${state}`);
      output.push(`     ${component.description}`);
      output.push(`     ${paint("2", componentMetadata(component, recommendation))}`);
    }
    output.push("");
  }

  return output.join("\n").trimEnd();
}

export function formatSelection(components) {
  const lines = [];
  for (const section of sections) {
    const names = components.filter((component) => component.kind === section.kind).map(({ name }) => name);
    if (names.length) lines.push(`${section.title.padEnd(15)} ${names.join(", ")}`);
  }
  const context = aggregateContextCost(components);
  if (context.words) {
    lines.push(`${"Always on".padEnd(15)} ${context.words} words · ~${context.estimatedTokens} tokens per session`);
  }
  return formatStage("Selected", lines.length ? lines : [paint("2", "None")]);
}

export function formatComponentGuide(component, options = {}) {
  const guide = componentGuide(component, options);
  const width = Math.max(40, Math.min(100, process.stdout.columns ?? 80));
  const flags = [
    options.scope === "user" && component.scopes.includes("user") ? "--scope user" : "",
    options.adapters?.length ? `--agent ${options.adapters.join(",")}` : "",
  ].filter(Boolean).join(" ");
  const labelWidth = Math.max(...guide.facts.map(([label]) => label.length)) + 2;
  const pathWidth = Math.max(...guide.files.map(([file]) => file.length)) + 2;
  return [
    [paint("1", guide.name), paint("2", `${component.id} · ${guide.meta}`)].join("\n"),
    wrapText(guide.summary, width).join("\n"),
    guide.facts.flatMap(([label, text]) => wrapText(text, width - labelWidth - 2)
      .map((line, index) => `  ${index ? " ".repeat(labelWidth) : paint("2", label.padEnd(labelWidth))}${line}`)).join("\n"),
    [paint("1", "Files"), ...guide.files.map(([file, note]) => `  ${file.padEnd(pathWidth)}${paint("2", note)}`)].join("\n"),
    [paint("1", guide.content.title), ...guide.content.text.replace(/\n+$/, "").split("\n").map((line) => `  ${paint("2", "│")} ${line}`)].join("\n"),
    `${paint("2", "Install")}  agent-suitup add ${component.id}${flags ? ` ${flags}` : ""}`,
  ].join("\n\n");
}

export function formatSetupStep(step) {
  return ["Agents", "Choose", "Review"].map((label, index) => index + 1 < step ? paint("2", `✓ ${label}`)
    : index + 1 === step ? paint("1;36", `${index + 1} ${label}`) : paint("2", `${index + 1} ${label}`)).join(paint("2", "  ›  "));
}

export function formatScopeChoice(scope) {
  return scope === "user"
    ? "Install for: all projects, in your home folder; blocks stay in this project. Type u to install in this project instead."
    : "Install for: this project. Type u to install skills, skill commands, and integrations for all projects instead.";
}

// One review block: what is installed, for which agents and where, then every file it touches.
export function formatInstallReview(planner, manifest, components) {
  const width = Math.max(60, Math.min(100, process.stdout.columns ?? 80));
  const scopes = new Map(manifest.components.map(({ id, scope }) => [id, scope]));
  const context = aggregateContextCost(manifest.components.map(({ id }) => requireComponent(id)));
  const chosen = components.filter(({ id }) => scopes.has(id));
  const movable = chosen.filter((component) => component.scopes.length > 1);
  const global = movable.filter(({ id }) => scopes.get(id) === "user");
  const mixed = global.length > 0 && global.length < movable.length;
  const local = chosen.filter(({ id }) => scopes.get(id) !== "user");
  const rows = [
    ["Agents", manifest.adapters.length ? agentNames(manifest.adapters).join(", ") : "none (portable files only)"],
    ["Install for", !global.length || mixed ? "this project"
      : `all projects, in your home folder${local.length
        ? ` · ${[...new Set(local.map(({ kind }) => componentKinds[kind].plural.toLowerCase()))].join(", ")} stay in this project` : ""}`],
    null,
  ];
  for (const section of sections) {
    const items = chosen.filter((component) => component.kind === section.kind);
    if (!items.length) continue;
    rows.push([`${section.title} (${items.length})`, items.map((component) =>
      mixed && scopes.get(component.id) === "user" ? `${component.name} (all projects)` : component.name).join(", ")]);
  }
  if (context.words) rows.push(["Always on", `${context.words} words · ~${context.estimatedTokens} tokens per session`]);
  const operations = planner.operations();
  if (operations.length) rows.push(null, ["Files", fileCounts(operations)]);
  const labelWidth = Math.max(...rows.filter(Boolean).map(([label]) => label.length)) + 2;
  const lines = rows.flatMap((row) => row ? wrapText(row[1], width - labelWidth - 2)
    .map((line, index) => `${index ? " ".repeat(labelWidth) : paint("2", row[0].padEnd(labelWidth))}${line}`) : [""]);
  lines.push(...operationPreview(operations, { review: true }).map((line) => `  ${line}`));
  return [formatStage("Ready to install", lines), planner.notes.length ? formatNotes(planner.notes) : ""]
    .filter(Boolean).join("\n\n");
}

export function formatApprovalPrompt() {
  return `${paint("1;36", "❯")} ${paint("1", "Install this selection?")} ${paint("2", "[Y/n · p preview]")} `;
}

function fileCounts(operations) {
  const removed = operations.filter(({ after }) => after.kind === "missing").length;
  const added = operations.filter(({ before, after }) => before.kind === "missing" && after.kind !== "missing").length;
  return [
    added ? paint("32", `${added} new`) : "",
    operations.length - added - removed ? paint("33", `${operations.length - added - removed} changed`) : "",
    removed ? paint("31", `${removed} removed`) : "",
  ].filter(Boolean).join(paint("2", " · "));
}

export function formatProgress(message) {
  return `${paint("35", "◇")} ${paint("1", message)}`;
}

export function formatApplySummary(planner, {
  components = [], action = "Applied", reviewed = false, suggestMore = false, adapters = [],
} = {}) {
  const operations = planner.operations();
  if (!operations.length && !planner.notes.length) return "No file changes.";
  const output = [];

  if (!reviewed) {
    if (components.length) output.push(formatSelection(components));
    output.push(formatChanges(planner));
  }
  const footer = [
    `${paint("32", "╰─")} ${paint("1;32", action)} · ${operations.length} file change${operations.length === 1 ? "" : "s"}`,
    `   ${paint("2", "Next")}  agent-suitup doctor`,
  ];
  if (suggestMore) footer.push(`   ${paint("2", "More")}  agent-suitup add --interactive`);
  const commands = components.filter(({ kind }) => kind === "command");
  const skills = components.filter(({ kind }) => kind === "skill");
  if (skills.length && !/removed/i.test(action)) {
    footer.push(`   ${paint("2", "Use")}   Ask your agent: "Use ${skills[0].id.slice("skill/".length)} for this task."`);
  }
  if (commands.length && !/removed/i.test(action)) {
    const chosen = adapters.length ? adapters : undefined;
    for (const { id } of commands) footer.push(`   ${paint("2", "Run")}   ${invocations(id.slice("command/".length), chosen)}`);
  }
  output.push(footer.join("\n"));
  return output.join("\n\n");
}

function formatChanges(planner) {
  const operations = planner.operations();
  const creates = operations.filter(({ before, after }) => before.kind === "missing" && after.kind !== "missing");
  const removes = operations.filter(({ after }) => after.kind === "missing");
  const updates = operations.filter(({ before, after }) => before.kind !== "missing" && after.kind !== "missing");
  const sections = [];
  if (operations.length) sections.push(formatStage("Files", [
    `${paint("32", `+${creates.length}`)} new  ${paint("33", `~${updates.length}`)} changed  ${paint("31", `-${removes.length}`)} removed`,
    ...operationPreview(operations),
  ]));
  if (planner.notes.length) sections.push(formatNotes(planner.notes));
  return sections.join("\n\n");
}

export function formatNotes(notes) {
  return formatStage("Manual steps (not executed)", notes);
}

export function formatHealthy(componentCount) {
  return `${paint("32", "◆")} ${paint("1;32", "Healthy")} · ${componentCount} component${componentCount === 1 ? " matches" : "s match"} the manifest and lockfile.`;
}

export function formatDryRunFooter() {
  return `${paint("33", "╰─")} ${paint("1", "Dry run complete")} · no files written and no external commands executed.`;
}

export function formatListHeader(componentCount, installedCount, filter = null) {
  const scope = filter ? `${sectionTitle(filter)} · ` : "";
  return `${paint("35", "◇")} ${scope}${componentCount} available${installedCount ? ` · ${installedCount} installed` : ""}`;
}

export function sectionTitle(kind) {
  return sections.find((section) => section.kind === kind)?.title ?? kind;
}

function formatStage(title, lines) {
  const output = [`${paint("35", "◇")} ${paint("1", title)}`];
  lines.forEach((line, index) => {
    output.push(`${paint("2", index === lines.length - 1 ? "╰" : "│")}${line ? ` ${line}` : ""}`);
  });
  return output.join("\n");
}

function componentMetadata(component, recommendation) {
  const parts = [];
  if (component.adapters?.length) parts.push(`${agentNames(component.adapters).join(", ")} only`);
  parts.push(component.scopes.join("/"));
  if (component.context) {
    const loading = {
      always: "always on",
      "on-demand": "loads when relevant",
      explicit: "runs when invoked",
      none: "no prompt context",
    }[component.context.loading] ?? component.context.loading;
    parts.push(loading);
    const cost = componentContextCost(component);
    if (component.kind === "block") parts.push(`${cost.words} words`);
    if (cost.estimatedTokens) parts.push(`~${cost.estimatedTokens} tokens`);
  }
  if (component.requires?.commands?.length) parts.push(`requires ${component.requires.commands.join(", ")}`);
  if (component.conflictsWith?.length) parts.push(`conflicts with ${component.conflictsWith.join(", ")}`);
  if (recommendation.pick && recommendation.reason) parts.push(`suggested: ${recommendation.reason}`);
  return parts.join(" · ");
}

// Lists changed files, noting what AGENTS.md receives since users own the rest of it.
// The review lists agent-suitup's own state last and dimmed, without the ./ prefix.
function operationPreview(operations, { review = false } = {}) {
  const limit = 12;
  const state = ({ label }) => label.startsWith("./.agent-suitup/");
  const ordered = review ? [...operations.filter((operation) => !state(operation)), ...operations.filter(state)] : operations;
  const lines = ordered.slice(0, limit).map((operation) => {
    const { before, after } = operation;
    const label = review ? operation.label.replace(/^\.\//, "") : operation.label;
    const linked = (state) => typeof state.content === "string" && state.content.includes("<!--as:rules-->");
    const note = operation.label === "./AGENTS.md" && linked(after) && !linked(before) ? paint("2", "  adds a one-line link to .agents/rules.md") : "";
    if (review && state(operation)) {
      return paint("2", `${after.kind === "missing" ? "−" : before.kind === "missing" ? "+" : "~"} ${label}  agent-suitup state`);
    }
    if (after.kind === "missing") return `${paint("31", "−")} ${label}`;
    if (after.kind === "symlink") return `${paint(before.kind === "missing" ? "32" : "33", before.kind === "missing" ? "+" : "~")} ${label} ${paint("2", `→ ${after.target}`)}`;
    if (before.kind === "missing") return `${paint("32", "+")} ${label}${note}`;
    return `${paint("33", "~")} ${label}${note}`;
  });
  if (operations.length > limit) lines.push(paint("2", `… ${operations.length - limit} more files`));
  return lines;
}

function wrapText(value, width) {
  const lines = [""];
  for (const word of value.split(/\s+/)) {
    const last = lines.length - 1;
    if (lines[last] && `${lines[last]} ${word}`.length > width) lines.push(word);
    else lines[last] += `${lines[last] ? " " : ""}${word}`;
  }
  return lines;
}

export function paint(code, value) {
  if (!useColor()) return value;
  return `\u001b[${code}m${value}\u001b[0m`;
}

function useColor() {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== "0") return true;
  return Boolean(process.stdout.isTTY && process.env.TERM !== "dumb");
}
