import { aggregateContextCost, componentContextCost, requireComponent } from "./catalog.mjs";
import { componentGuide } from "./component-guide.mjs";

const sections = [
  {
    kind: "block",
    title: "Instruction blocks",
    description: "Always-on guidance inside owned AGENTS.md markers; existing text is preserved",
  },
  {
    kind: "skill",
    title: "Skills",
    description: "On-demand expertise with optional references and resources",
  },
  {
    kind: "command",
    title: "Commands",
    description: "Explicit skills invoked as $name in Codex or /name in Grok and Claude",
  },
  {
    kind: "plugin",
    title: "Agent integrations",
    description: "Vendor-native plugins, language servers, and marketplaces",
  },
];

const sectionAliases = new Map([
  ["block", "block"],
  ["blocks", "block"],
  ["instruction", "block"],
  ["instructions", "block"],
  ["skill", "skill"],
  ["skills", "skill"],
  ["command", "command"],
  ["commands", "command"],
  ["plugin", "plugin"],
  ["plugins", "plugin"],
  ["integration", "plugin"],
  ["integrations", "plugin"],
]);

export function sectionKind(value) {
  if (!value || value === "all") return null;
  const kind = sectionAliases.get(value.toLowerCase());
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

export function formatBanner(subtitle = "Curate the agent layer for this repository.") {
  const title = `${paint("1;36", "AGENT")} ${paint("2", "/")} ${paint("1;35", "SUITUP")}`;
  return [
    "",
    `${paint("36", "╭─")} ${title}`,
    `${paint("36", "│")}  ${paint("2", subtitle)}`,
    paint("36", "╰────────────────────────────────────────────────────────"),
  ].join("\n");
}

export function formatProjectScan({ cwd, stack, catalogSize, suggestedCount, installedCount = 0 }) {
  return formatStage("Project scan", [
    paint("2", cwd),
    `Stack      ${stack.length ? stack.join(paint("2", " · ")) : paint("2", "No specific stack detected")}`,
    `Catalog    ${catalogSize} curated components · ${suggestedCount} suggested${installedCount ? ` · ${installedCount} installed` : ""}`,
  ]);
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
    const ids = components.filter((component) => component.kind === section.kind).map(({ id }) => id);
    if (ids.length) lines.push(`${section.title.padEnd(20)} ${ids.join(", ")}`);
  }
  const context = aggregateContextCost(components);
  if (context.words) {
    lines.push(`Always-loaded text   ${context.words} words · ~${context.estimatedTokens} tokens`);
  }
  return formatStage("Selected components", lines.length ? lines : [paint("2", "None")]);
}

export function formatComponentGuide(component, options = {}) {
  const guide = componentGuide(component, options);
  const flags = [
    options.scope === "user" && component.scopes.includes("user") ? "--scope user" : "",
    options.adapters?.length ? `--adapter ${options.adapters.join(",")}` : "",
  ].filter(Boolean).join(" ");
  return [
    `${paint("1;36", component.name)} · ${guide.kind.name}\n${paint("2", component.id)}`,
    ...guide.sections.map(([title, text]) => formatStage(title, [text])),
    `Install  agent-suitup add ${component.id}${flags ? ` ${flags}` : ""}`,
  ].join("\n\n");
}

export function formatSetupStep(step) {
  return ["Explore", "Connect", "Review"].map((label, index) =>
    paint(index + 1 === step ? "1;36" : "2", `${index + 1 < step ? "✓" : `0${index + 1}`} ${label}`)).join(paint("2", "  →  "));
}

export function formatInstallReview(planner, manifest, components) {
  const scopes = new Map(manifest.components.map(({ id, scope }) => [id, scope]));
  const context = aggregateContextCost(manifest.components.map(({ id }) => requireComponent(id)));
  return [
    formatStage("Ready to install", components.filter(({ id }) => scopes.has(id)).map((component) =>
      `${component.name} · ${scopes.get(component.id) === "user" ? "user (all projects)" : "this project"}`)),
    formatStage("Your setup", [
      `Adapters  ${manifest.adapters.length ? manifest.adapters.join(", ") : "canonical files only"}`,
      `Always loaded  ${context.words} words · ~${context.estimatedTokens} tokens total`,
    ]),
    formatChanges(planner),
  ].filter(Boolean).join("\n\n");
}

export function formatProgress(message) {
  return `${paint("35", "◇")} ${paint("1", message)}`;
}

export function formatApplySummary(planner, { components = [], action = "Applied", reviewed = false } = {}) {
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
  if (action === "Agent Suitup ready") footer.push(`   ${paint("2", "More")}  agent-suitup add --interactive`);
  const commands = components.filter(({ kind }) => kind === "command");
  const skills = components.filter(({ kind }) => kind === "skill");
  if (skills.length && !/removed/i.test(action)) {
    footer.push(`   ${paint("2", "Use")}   Ask your agent: Use ${skills[0].id.slice("skill/".length)} for this task.`);
    footer.push(`         Skills load on demand from .agents/skills in the chosen project or user scope.`);
  }
  if (commands.length && !/removed/i.test(action)) {
    footer.push(`   ${paint("2", "Try")}   ${commands.map(({ id }) => {
      const name = id.slice("command/".length);
      return `$${name} · /${name}`;
    }).join("  ")}`);
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
  if (operations.length) sections.push(formatStage("Change set", [
    `${paint("32", `+${creates.length}`)} create  ${paint("33", `~${updates.length}`)} update  ${paint("31", `-${removes.length}`)} remove`,
    ...operationPreview(operations),
  ]));
  if (planner.notes.length) sections.push(formatStage("Manual steps (not executed)", planner.notes));
  return sections.join("\n\n");
}

export function formatHealthy(componentCount, hasManualSteps = false) {
  const detail = hasManualSteps ? " · manual tools are recorded but not asserted" : "";
  return `${paint("32", "◆")} ${paint("1;32", "Healthy")} · ${componentCount} component${componentCount === 1 ? "" : "s"} match the manifest and lockfile${detail}.`;
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
    output.push(`${paint("2", index === lines.length - 1 ? "╰" : "│")} ${line}`);
  });
  return output.join("\n");
}

function componentMetadata(component, recommendation) {
  const parts = [];
  parts.push(component.adapters?.length ? component.adapters.map(capitalize).join("/") : "portable");
  parts.push(component.scopes.join("/"));
  if (component.context) {
    const loading = {
      always: "always loaded",
      "on-demand": "on demand",
      explicit: "explicit",
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

function operationPreview(operations) {
  const limit = 10;
  const lines = operations.slice(0, limit).map(({ before, after, label }) => {
    if (after.kind === "missing") return `${paint("31", "−")} ${label}`;
    if (before.kind === "missing") return `${paint("32", "+")} ${label}`;
    return `${paint("33", "~")} ${label}`;
  });
  if (operations.length > limit) lines.push(paint("2", `… ${operations.length - limit} more files`));
  return lines;
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function paint(code, value) {
  if (!useColor()) return value;
  return `\u001b[${code}m${value}\u001b[0m`;
}

function useColor() {
  if (Object.hasOwn(process.env, "NO_COLOR")) return false;
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== "0") return true;
  return Boolean(process.stdout.isTTY && process.env.TERM !== "dumb");
}
