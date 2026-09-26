import fs from "node:fs";
import path from "node:path";
import { commandAvailable } from "./detect.mjs";

// The coding agents agent-suitup sets up. Every agent reads AGENTS.md; they
// differ in where they discover skills and how skill commands are invoked.
export const agents = [
  { id: "claude", name: "Claude Code", folder: ".claude", setup: "skills in .claude/skills (linked) · /skill-name" },
  { id: "codex", name: "Codex", folder: ".codex", setup: "skills in .agents/skills · $skill-name" },
  { id: "grok", name: "Grok Build", folder: ".grok", setup: "skills in .agents/skills · /skill-name" },
];

export const agentIds = agents.map(({ id }) => id);

export function agentNames(ids) {
  return agents.filter(({ id }) => ids.includes(id)).map(({ name }) => name);
}

// An installed CLI or a project folder marks an agent as detected. Detection
// only labels a choice; it never selects one.
export function detectAgents({ cwd, environment = process.env } = {}) {
  return new Set(agents
    .filter(({ id, folder }) => commandAvailable(id, environment) || fs.existsSync(path.join(cwd, folder)))
    .map(({ id }) => id));
}
