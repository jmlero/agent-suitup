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

export const supportedAdapters = ["claude", "codex", "grok"];

export function emptyManifest(adapters = []) {
  return { manifestVersion: 2, adapters, components: [] };
}

export function emptyLock() {
  return { lockfileVersion: 1, components: {} };
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
  return lock;
}

export function validateManifest(manifest) {
  if (manifest.manifestVersion !== 2) throw new Error("Unsupported manifest version");
  if (!Array.isArray(manifest.adapters)) throw new Error("Manifest adapters must be an array");
  for (const adapter of manifest.adapters) {
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
  return normalizeManifest(manifest);
}

export function normalizeManifest(manifest) {
  return {
    manifestVersion: 2,
    adapters: [...new Set(manifest.adapters)].sort(),
    components: [...manifest.components]
      .map(({ id, scope }) => ({ id, scope }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
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
