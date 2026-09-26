import path from "node:path";

// Agents that could otherwise start a command on their own receive a
// metadata-only wrapper that allows slash invocation and points to the
// canonical workflow instead of copying it.
export const commandBridgeAgents = ["claude", "grok"];

export function commandBridge({ agent, component, scope, cwd, home, canonical }) {
  const root = scope === "user" ? home : cwd;
  const name = component.id.slice("command/".length);
  const file = path.join(root, `.${agent}`, "skills", name, "SKILL.md");
  const target = path.relative(path.dirname(file), canonical).split(path.sep).join("/");
  const content = [
    "---",
    `name: ${name}`,
    `description: ${JSON.stringify(component.description)}`,
    "disable-model-invocation: true",
    "---",
    "",
    `Follow the canonical workflow in [${name}](${target}).`,
    "",
  ].join("\n");
  return { file, content };
}
