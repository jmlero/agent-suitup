import fs from "node:fs";
import path from "node:path";

export const stateDirectoryName = ".agent-suitup";
export const manifestFileName = "manifest.json";
export const lockFileName = "lock.json";

export function statePaths(cwd) {
  const directory = path.join(cwd, stateDirectoryName);
  return {
    directory,
    manifest: path.join(directory, manifestFileName),
    lock: path.join(directory, lockFileName),
  };
}

export const supportedAdapters = ["claude", "grok"];

export function emptyManifest(adapters = []) {
  return { manifestVersion: 2, adapters, components: [] };
}

export function emptyLock() {
  return { lockfileVersion: 1, components: {}, bridges: {} };
}

export function readManifest(cwd, { required = false } = {}) {
  const file = statePaths(cwd).manifest;
  if (!fs.existsSync(file)) {
    if (required) throw new Error(`No manifest found. Run \`agent-suitup init\` first.`);
    return null;
  }
  return validateManifest(readJson(file));
}

export function readLock(cwd) {
  const file = statePaths(cwd).lock;
  if (!fs.existsSync(file)) return emptyLock();
  const lock = readJson(file);
  if (lock.lockfileVersion !== 1 || !lock.components) {
    throw new Error(`Unsupported lockfile: ${file}`);
  }
  lock.bridges ??= {};
  return lock;
}

export function validateManifest(manifest) {
  if (!new Set([1, 2]).has(manifest.manifestVersion)) throw new Error("Unsupported manifest version");
  const adapters = manifest.manifestVersion === 1
    ? migrateTargets(manifest.targets)
    : manifest.adapters;
  if (!Array.isArray(adapters)) throw new Error("Manifest adapters must be an array");
  for (const adapter of adapters) {
    if (!supportedAdapters.includes(adapter)) throw new Error(`Unsupported adapter in manifest: ${adapter}`);
  }
  if (!Array.isArray(manifest.components)) throw new Error("Manifest components must be an array");
  const ids = new Set();
  for (const component of manifest.components) {
    if (!component?.id || ids.has(component.id)) {
      throw new Error(`Invalid or duplicate manifest component: ${component?.id ?? "<missing>"}`);
    }
    if (!new Set(["project", "user"]).has(component.scope)) {
      throw new Error(`Invalid scope for ${component.id}: ${component.scope}`);
    }
    ids.add(component.id);
  }
  return normalizeManifest({ ...manifest, adapters });
}

export function normalizeManifest(manifest) {
  const adapters = manifest.adapters ?? migrateTargets(manifest.targets);
  return {
    manifestVersion: 2,
    adapters: [...new Set(adapters)].sort(),
    components: [...manifest.components]
      .map(({ id, scope }) => ({ id, scope }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
}

function migrateTargets(targets) {
  if (!Array.isArray(targets) || !targets.length) {
    throw new Error("Legacy manifest must select at least one target");
  }
  for (const target of targets) {
    if (!new Set(["claude", "codex"]).has(target)) {
      throw new Error(`Unsupported target in legacy manifest: ${target}`);
    }
  }
  return targets.includes("claude") ? ["claude"] : [];
}

export function jsonDocument(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`Failed to parse ${file}: ${error.message}`);
  }
}
