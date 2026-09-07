import path from "node:path";

export function grokCommandBridge({ component, scope, cwd, home, canonical }) {
  const root = scope === "user" ? home : cwd;
  const name = component.id.slice("command/".length);
  const file = path.join(root, ".grok", "skills", name, "SKILL.md");
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
