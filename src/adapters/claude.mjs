import fs from "node:fs";
import path from "node:path";
import { jsonDocument } from "../state.mjs";

export class ClaudeSettingsEditor {
  constructor({ cwd, home, previousLock }) {
    this.cwd = cwd;
    this.home = home;
    this.documents = new Map();
    // Marketplace entries agent-suitup added, by settings scope. Any plugin
    // entry that relies on one records it, so ownership survives removals.
    this.ownedMarketplaces = new Set(Object.values(previousLock?.components ?? {})
      .filter((entry) => entry.kind === "plugin" && entry.marketplaceCreated && entry.adapter?.claude)
      .map((entry) => marketplaceKey(entry.scope, entry.adapter.claude.marketplace.name)));
  }

  // Returns whether agent-suitup owns the marketplace entry the plugin uses.
  enablePlugin(component, scope) {
    const adapter = component.adapter.claude;
    const key = marketplaceKey(scope, adapter.marketplace.name);
    const scoped = this.get(scope);
    scoped.data.extraKnownMarketplaces ??= {};
    if (!scoped.data.extraKnownMarketplaces[adapter.marketplace.name]) {
      scoped.data.extraKnownMarketplaces[adapter.marketplace.name] = marketplaceEntry(adapter);
      this.ownedMarketplaces.add(key);
    }
    scoped.data.enabledPlugins ??= {};
    scoped.data.enabledPlugins[`${adapter.pluginId}@${adapter.marketplace.name}`] = true;
    return this.ownedMarketplaces.has(key);
  }

  disablePlugin(component, scope) {
    this.disablePluginAdapter(component.adapter, scope);
  }

  disablePluginAdapter(componentAdapter, scope) {
    const adapter = componentAdapter?.claude;
    if (!adapter) return;
    const scoped = this.get(scope);
    if (scoped.data.enabledPlugins) {
      delete scoped.data.enabledPlugins[`${adapter.pluginId}@${adapter.marketplace.name}`];
      removeEmptyObject(scoped.data, "enabledPlugins");
    }
    this.releaseMarketplace(scoped.data, adapter, scope);
  }

  // Installs run before removals, so every plugin kept in this scope has
  // already re-enabled itself when an owned marketplace is released.
  releaseMarketplace(data, adapter, scope) {
    const { name } = adapter.marketplace;
    if (!this.ownedMarketplaces.has(marketplaceKey(scope, name))) return;
    if (Object.keys(data.enabledPlugins ?? {}).some((plugin) => plugin.endsWith(`@${name}`))) return;
    const entry = data.extraKnownMarketplaces?.[name];
    if (!entry || JSON.stringify(entry) !== JSON.stringify(marketplaceEntry(adapter))) return;
    delete data.extraKnownMarketplaces[name];
    removeEmptyObject(data, "extraKnownMarketplaces");
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

function marketplaceKey(scope, name) {
  return `${scope}:${name}`;
}

function marketplaceEntry(adapter) {
  return { source: { source: "github", repo: adapter.marketplace.repo } };
}

function removeEmptyObject(parent, key) {
  if (parent[key] && !Object.keys(parent[key]).length) delete parent[key];
}
