import { agentIds, agentNames } from "./agents.mjs";
import { bundledContent, componentContextCost, readCatalogText } from "./catalog.mjs";
import { rulesFile } from "./reconcile.mjs";

export const componentKinds = {
  block: {
    name: "Block", plural: "Blocks", summary: "always-on rules", color: "33",
    about: "Always-on rules in .agents/rules.md, linked from AGENTS.md; your own text is preserved",
  },
  skill: {
    name: "Skill", plural: "Skills", summary: "loaded when relevant", color: "36",
    about: "Workflows the agent loads when a task needs them",
  },
  command: {
    name: "Skill command", plural: "Skill commands", summary: "run with /name", color: "35",
    about: "Skills that run only when you invoke them: /name in Claude Code and Grok Build, $name in Codex",
  },
  plugin: {
    name: "Integration", plural: "Integrations", summary: "Claude Code plugins", color: "34",
    about: "Claude Code plugins; their prerequisites are set up separately",
  },
};

// Catalog explanations are selection aids, never extra installed instructions.
// The guide shows what an item adds: the files each chosen agent reads and the
// exact text written to them.
export function componentGuide(component, { scope = "project", adapters = [], recommendation = {} } = {}) {
  const kind = componentKinds[component.kind];
  const name = component.id.slice(component.id.indexOf("/") + 1);
  const root = scope === "user" && component.scopes.includes("user") ? "~/" : "";
  const agents = adapters.length ? adapters : agentIds;
  const facts = [["Use when", component.selection?.when ?? component.description]];
  if (component.kind === "command") {
    facts.push(["Run it", `${invocations(name, agents)}. The agent never starts it on its own.`]);
  } else {
    facts.push(["Example", component.selection?.example ?? `Choose ${component.name} for ${component.category.toLowerCase()}.`]);
  }
  facts.push(["Consider", component.selection?.consider ?? "Review alongside your existing project guidance."]);
  if (component.requires?.commands?.length) {
    facts.push(["Requires", `${component.requires.commands.join(", ")} on PATH; agent-suitup does not install it.`]);
  }
  if (recommendation.pick && recommendation.reason) {
    facts.push(["Suggested", `${recommendation.reason}. A relevance signal, not a default.`]);
  }
  facts.push(["Source", source(component)]);
  return {
    kind,
    name: component.name,
    id: component.id,
    meta: meta(component, kind),
    summary: component.outcome ?? component.description,
    facts,
    files: files(component, { name, root, agents }),
    content: content(component, root),
  };
}

function meta(component, kind) {
  const cost = componentContextCost(component);
  if (component.kind === "block") return `${kind.name} · always on · ${cost.words} words, ~${cost.estimatedTokens} tokens in every session`;
  if (component.kind === "plugin") return `${kind.name} · Claude Code plugin`;
  const estimate = component.content.kind === "remote" ? " (catalog estimate)" : "";
  const loading = component.kind === "command" ? "runs when you invoke it" : "loads when relevant";
  return `${kind.name} · ${loading} · ~${cost.estimatedTokens} tokens when used${estimate}`;
}

function files(component, { name, root, agents }) {
  if (component.kind === "block") {
    return [
      [rulesFile, "this block, between agent-suitup markers"],
      ["AGENTS.md", "one link line, shared by all blocks"],
    ];
  }
  if (component.kind === "plugin") {
    return [[`${root}.claude/settings.json`, "enables the plugin and registers its marketplace if missing"]];
  }
  const canonical = `${root}.agents/skills/${name}/`;
  // Claude Code never reads .agents/skills; Grok runs commands through its wrapper.
  const readers = agentNames(agents.filter((agent) => agent === "codex" || (agent === "grok" && component.kind !== "command")));
  const result = [[canonical, readers.length
    ? `${readers.join(" and ")} read${readers.length === 1 ? "s" : ""} it here`
    : "source files"]];
  if (component.kind === "skill" && agents.includes("claude")) {
    result.push([`${root}.claude/skills/${name}`, `Claude Code reads it here (${process.platform === "win32" ? "copy" : "link"})`]);
  }
  if (component.kind === "command") {
    if (agents.includes("claude")) result.push([`${root}.claude/skills/${name}/SKILL.md`, `Claude Code · /${name} only`]);
    if (agents.includes("grok")) result.push([`${root}.grok/skills/${name}/SKILL.md`, `Grok Build · /${name} only`]);
  }
  return result;
}

export function invocations(name, agents = agentIds) {
  const slash = agentNames(agents.filter((agent) => agent !== "codex"));
  return [
    slash.length ? `/${name} in ${slash.join(" or ")}` : "",
    agents.includes("codex") ? `$${name} in Codex` : "",
  ].filter(Boolean).join(", ");
}

function content(component, root) {
  if (component.kind === "block") return { title: `Adds to ${rulesFile}`, text: bundledContent(component) };
  if (component.kind === "plugin") {
    const { pluginId, marketplace } = component.adapter.claude;
    return {
      title: `Adds to ${root}.claude/settings.json`,
      text: JSON.stringify({
        enabledPlugins: { [`${pluginId}@${marketplace.name}`]: true },
        extraKnownMarketplaces: { [marketplace.name]: { source: { source: "github", repo: marketplace.repo } } },
      }, null, 2),
    };
  }
  if (component.content.kind === "remote") {
    const revision = /\/([0-9a-f]{40})\//.exec(component.content.url)?.[1]?.slice(0, 7);
    const overlay = component.content.overlay ? `\n\nagent-suitup adds this section at the top:\n\n${readCatalogText(component.content.overlay, component.id)}` : "";
    return {
      title: "SKILL.md",
      text: `Downloaded from ${component.content.upstream}${revision ? ` at ${revision}` : ""} when you install it, with its references and license.${overlay}`,
    };
  }
  return { title: "SKILL.md", text: bundledContent(component) };
}

function source(component) {
  if (component.content?.kind === "remote") return `${component.content.upstream}, pinned in the catalog`;
  if (component.kind === "plugin") return `${component.adapter.claude.marketplace.repo} · verified ${component.lastVerified}`;
  return `Bundled with agent-suitup${component.content.upstream ? ` · adapted from ${component.content.upstream}` : ""}`;
}
