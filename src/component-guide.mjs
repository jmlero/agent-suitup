import { componentContextCost } from "./catalog.mjs";

export const componentKinds = {
  block: { name: "Block", loading: "Always loaded", color: "33" },
  skill: { name: "Skill", loading: "On demand", color: "36" },
  command: { name: "Command", loading: "Explicit invocation", color: "35" },
  plugin: { name: "Integration", loading: "Claude plugin", color: "34" },
};

// Catalog explanations are selection aids, never extra installed instructions.
export function componentGuide(component, { scope = "project", adapters = [], recommendation = {} } = {}) {
  const kind = componentKinds[component.kind];
  const cost = componentContextCost(component);
  const name = component.id.slice(component.id.indexOf("/") + 1);
  const root = scope === "user" && component.scopes.includes("user") ? "~/" : "./";
  const destination = component.kind === "block" ? "./AGENTS.md"
    : component.kind === "plugin" ? `${root}.claude/settings.json`
      : `${root}.agents/skills/${name}/SKILL.md`;
  const loading = component.kind === "block" ? `${kind.loading} · ${cost.words} words · ~${cost.estimatedTokens} tokens`
    : component.kind === "plugin" ? "Claude only · plugin settings; runtime setup is separate"
      : `${kind.loading} · ~${cost.estimatedTokens} tokens when loaded${component.content.kind === "remote" ? " (catalog estimate)" : ""}`;
  const sections = [
    ["What it does", component.outcome ?? component.description],
    ["Use when", component.selection?.when ?? component.description],
    ["Example", component.selection?.example ?? `Choose ${component.name} for ${component.category.toLowerCase()}.`],
    ["Consider", component.selection?.consider ?? "Review alongside your existing project guidance."],
    ["Loading", loading],
    ["Installs to", destination],
  ];
  if (component.kind === "skill" || component.kind === "command") {
    sections.push(["How to use", component.kind === "skill"
      ? `Ask your agent to use ${name} for a matching task. The skill body loads on demand; discovery metadata may remain visible.`
      : `Invoke $${name} in Codex, /${name} in Claude or Grok with the corresponding adapter.`]);
    sections.push(["Agent setup", adapters.includes("claude")
      ? `Claude bridge: ${root}.claude/skills/${name}. Portable files stay canonical.`
      : "Portable files work directly with compatible agents. Choose Claude in Connect to add its skill bridge."]);
  }
  if (component.requires?.commands?.length) sections.push(["Requires", `${component.requires.commands.join(", ")} on PATH (not installed by agent-suitup)`]);
  if (recommendation.pick && recommendation.reason) sections.push(["Suggested because", `${recommendation.reason}. This is a relevance signal, not a default selection.`]);
  sections.push(["Source", component.content?.kind === "remote"
    ? `${component.content.upstream} · downloaded only for a chosen installation plan, then pinned with references and license`
    : component.kind === "plugin" ? `${component.adapter.claude.marketplace.repo} · catalog last verified ${component.lastVerified}`
      : `Bundled with agent-suitup${component.content.upstream ? ` · adapted from ${component.content.upstream}` : ""}`]);
  return { kind, sections, destination };
}
