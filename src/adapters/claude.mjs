import fs from "node:fs";
import path from "node:path";
import { jsonDocument } from "../state.mjs";

export class ClaudeSettingsEditor {
  constructor({ cwd, home }) {
    this.cwd = cwd;
    this.home = home;
    this.documents = new Map();
  }

  enablePlugin(component, scope) {
    const adapter = component.adapter.claude;
    const user = this.get("user");
    user.data.extraKnownMarketplaces ??= {};
    user.data.extraKnownMarketplaces[adapter.marketplace.name] ??= {
      source: { source: "github", repo: adapter.marketplace.repo },
    };

    const scoped = this.get(scope);
    scoped.data.enabledPlugins ??= {};
    scoped.data.enabledPlugins[`${adapter.pluginId}@${adapter.marketplace.name}`] = true;
  }

  disablePlugin(component, scope) {
    this.disablePluginAdapter(component.adapter, scope);
  }

  disablePluginAdapter(componentAdapter, scope) {
    const adapter = componentAdapter?.claude;
    if (!adapter) return;
    const scoped = this.get(scope);
    if (!scoped.data.enabledPlugins) return;
    delete scoped.data.enabledPlugins[`${adapter.pluginId}@${adapter.marketplace.name}`];
    removeEmptyObject(scoped.data, "enabledPlugins");
  }

  disableHook(scope, command) {
    const scoped = this.get(scope);
    const entries = scoped.data.hooks?.PreToolUse;
    if (!Array.isArray(entries)) return;
    scoped.data.hooks.PreToolUse = entries.filter((entry) => !containsHook([entry], command));
    if (!scoped.data.hooks.PreToolUse.length) delete scoped.data.hooks.PreToolUse;
    removeEmptyObject(scoped.data, "hooks");
  }

  flush(planner) {
    for (const document of this.documents.values()) {
      const content = jsonDocument(document.data);
      if (!document.existed && content === "{}\n") continue;
      planner.write(document.path, content, { allowExisting: true });
    }
  }

  get(scope) {
    const file = settingsPath(scope, this);
    if (this.documents.has(file)) return this.documents.get(file);
    const existed = fs.existsSync(file);
    let data = {};
    if (existed) {
      try {
        data = JSON.parse(fs.readFileSync(file, "utf8"));
      } catch (error) {
        throw new Error(`Failed to parse ${file}: ${error.message}`);
      }
    }
    const document = { path: file, existed, data };
    this.documents.set(file, document);
    return document;
  }
}

export function settingsPath(scope, { cwd, home }) {
  if (scope === "user") return path.join(home, ".claude", "settings.json");
  if (scope === "project") return path.join(cwd, ".claude", "settings.json");
  throw new Error(`Unknown Claude settings scope: ${scope}`);
}

function containsHook(entries, command) {
  return entries.some((entry) => Array.isArray(entry?.hooks)
    && entry.hooks.some((hook) => hook?.type === "command" && hook.command === command));
}

function removeEmptyObject(parent, key) {
  if (parent[key] && !Object.keys(parent[key]).length) delete parent[key];
}
