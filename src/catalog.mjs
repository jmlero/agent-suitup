import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { commandAvailable } from "./detect.mjs";
import { decodeText, integrity, normalizeText, stableJson } from "./integrity.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalogRoot = path.join(packageRoot, "catalog");
const catalogPath = path.join(catalogRoot, "catalog.json");
const remotePackageMaxFiles = 200;
const remotePackageMaxBytes = 2_000_000;
const remoteFetchTimeoutMs = 30_000;
const supportedCatalogAdapters = new Set(["claude", "grok"]);
const supportedKinds = new Set(["block", "skill", "command", "plugin"]);
const supportedScopes = new Set(["project", "user"]);
const supportedLoading = new Set(["always", "on-demand", "explicit", "none"]);
const componentIdPattern = /^(block|skill|command|plugin)\/[a-z0-9][a-z0-9-]*$/;
const slugPattern = /^[a-z0-9][a-z0-9-]*$/;
// Keep these key sets aligned with schemas/catalog.schema.json.
export const catalogKeys = {
  document: new Set(["$schema", "catalogVersion", "components"]),
  component: new Set([
    "id", "version", "kind", "name", "category", "description", "selection", "outcome",
    "alwaysOnJustification", "license", "lastVerified", "adapters", "scopes", "recommendedScope",
    "context", "content", "suggest", "requires", "adapter", "conflictsWith",
  ]),
  selection: new Set(["when", "consider", "example"]),
  context: new Set(["loading", "estimatedTokens"]),
  bundledContent: new Set(["kind", "path", "root", "upstream", "revision"]),
  remoteContent: new Set(["kind", "url", "upstream", "root", "overlay", "licensePath", "licenseTarget"]),
  suggest: new Set(["when", "reason"]),
  suggestWhen: new Set(["all", "any"]),
  requires: new Set(["commands"]),
  adapter: new Set(["claude"]),
  claudeAdapter: new Set(["pluginId", "marketplace"]),
  marketplace: new Set(["name", "repo"]),
};

let cachedCatalog;

export function loadCatalog() {
  if (cachedCatalog) return cachedCatalog;
  const parsed = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  if (parsed.catalogVersion !== 2 || !Array.isArray(parsed.components)) {
    throw new Error("Unsupported catalog document");
  }
  assertKeys(parsed, catalogKeys.document, "catalog document", catalogPath);
  const ids = new Set();

  for (const component of parsed.components) {
    validateCatalogComponent(component, ids);
  }

  cachedCatalog = parsed;
  return parsed;
}

export function listComponents() {
  return loadCatalog().components;
}

export function isPortable(component) {
  return !component.adapters?.length;
}

export function availableWithAdapters(component, adapters) {
  return isPortable(component)
    || component.adapters.some((adapter) => adapters.includes(adapter));
}

export function getComponent(id) {
  return listComponents().find((component) => component.id === id);
}

export function requireComponent(id) {
  const component = getComponent(id);
  if (!component) {
    const matches = listComponents()
      .map((candidate) => candidate.id)
      .filter((candidate) => candidate.includes(id));
    const hint = matches.length ? ` Did you mean: ${matches.join(", ")}?` : "";
    throw new Error(`Unknown component: ${id}.${hint}`);
  }
  return component;
}

export function bundledContent(component) {
  if (component.content?.kind !== "bundled") {
    throw new Error(`${component.id} does not have bundled content`);
  }
  const sourcePath = resolveBundledPath(component.content.path, component.id);
  return normalizeText(fs.readFileSync(sourcePath, "utf8"));
}

export function bundledPackage(component) {
  const content = bundledContent(component);
  if (!component.content.root) {
    return [{ path: "SKILL.md", content, mode: 0o644 }];
  }

  const sourceRoot = resolveBundledPath(component.content.root, component.id);
  const skillPath = resolveBundledPath(component.content.path, component.id);
  if (path.dirname(skillPath) !== sourceRoot || path.basename(skillPath) !== "SKILL.md") {
    throw new Error(`Bundled package path must point to its root SKILL.md: ${component.id}`);
  }

  const files = readBundledDirectory(sourceRoot, sourceRoot, component.id)
    .sort((left, right) => left.path.localeCompare(right.path));
  if (!files.some((file) => file.path === "SKILL.md")) {
    throw new Error(`Bundled package has no SKILL.md: ${component.id}`);
  }
  const totalBytes = files.reduce((sum, file) => sum + Buffer.byteLength(file.content), 0);
  if (files.length > remotePackageMaxFiles || totalBytes > remotePackageMaxBytes) {
    throw new Error(`Bundled package is too large: ${component.id}`);
  }
  return files;
}

export async function remoteContent(component) {
  return skillFile(await resolveRemotePackage(component), component.id).content;
}

export async function resolveRemoteContent(component) {
  const resolved = await resolveRemotePackage(component);
  return {
    ...resolved,
    content: skillFile(resolved, component.id).content,
  };
}

export async function resolveRemotePackage(component) {
  if (component.content?.kind !== "remote") {
    throw new Error(`${component.id} does not have remote content`);
  }
  // Catalog validation pins every remote source to an immutable revision, so
  // content changes only when the catalog deliberately bumps it.
  const { url, upstream } = component.content;
  const github = parseGitHubRawUrl(url);
  const source = { kind: "remote", url, resolvedUrl: url, revision: github.ref, upstream };

  if (!component.content.root) {
    const files = applyRemoteOverlay(component, [
      { path: "SKILL.md", content: await fetchRemoteFile(url, component.id), mode: 0o644 },
    ]);
    skillFile({ files }, component.id);
    return { files, source };
  }

  const root = normalizeRemotePath(component.content.root, `${component.id} root`);
  const tree = await fetchGitHubJson(
    `https://api.github.com/repos/${github.owner}/${github.repository}/git/trees/${github.ref}?recursive=1`,
    component.id,
  );
  if (tree.truncated) throw new Error(`Remote tree is truncated: ${component.id}`);

  const descriptors = (tree.tree ?? [])
    .filter((entry) => entry.type === "blob" && entry.path.startsWith(`${root}/`))
    .map((entry) => ({
      path: normalizePackagePath(entry.path.slice(root.length + 1), component.id),
      resolvedUrl: `https://raw.githubusercontent.com/${github.owner}/${github.repository}/${github.ref}/${entry.path}`,
      mode: entry.mode === "100755" ? 0o755 : 0o644,
      size: entry.size ?? 0,
    }));

  if (component.content.licensePath) {
    const licensePath = normalizeRemotePath(component.content.licensePath, `${component.id} license path`);
    const treeEntry = (tree.tree ?? []).find((entry) => entry.type === "blob" && entry.path === licensePath);
    if (!treeEntry) throw new Error(`Remote license file not found: ${component.id}`);
    descriptors.push({
      path: normalizePackagePath(component.content.licenseTarget ?? "LICENSE", component.id),
      resolvedUrl: `https://raw.githubusercontent.com/${github.owner}/${github.repository}/${github.ref}/${licensePath}`,
      mode: 0o644,
      size: treeEntry.size ?? 0,
    });
  }

  descriptors.sort((left, right) => left.path.localeCompare(right.path));
  validateRemoteDescriptors(descriptors, component.id);
  const rawFiles = await fetchResolvedFiles(descriptors, component.id);
  const files = applyRemoteOverlay(component, rawFiles);
  skillFile({ files }, component.id);
  return {
    files,
    source: {
      ...source,
      root,
      resolvedFiles: descriptors.map((descriptor, index) => ({
        path: descriptor.path,
        resolvedUrl: descriptor.resolvedUrl,
        mode: descriptor.mode,
        integrity: integrity(rawFiles[index].content),
      })),
    },
  };
}

export async function lockedRemoteContent(componentOrId, source) {
  const resolved = await lockedRemotePackage(componentOrId, source);
  const componentId = typeof componentOrId === "string" ? componentOrId : componentOrId.id;
  return skillFile(resolved, componentId).content;
}

export async function lockedRemotePackage(componentOrId, source) {
  const component = typeof componentOrId === "string" ? getComponent(componentOrId) : componentOrId;
  const componentId = component?.id ?? componentOrId;
  if (source?.resolvedFiles?.length) {
    validateRemoteDescriptors(source.resolvedFiles, componentId);
    const files = await fetchResolvedFiles(source.resolvedFiles, componentId, { verify: true });
    return { files: component ? applyRemoteOverlay(component, files) : files, source };
  }
  if (!source?.resolvedUrl) throw new Error(`Lockfile does not pin ${componentId}; run update to repair it`);
  const content = await fetchRemoteFile(source.resolvedUrl, componentId);
  const files = [{ path: "SKILL.md", content, mode: 0o644 }];
  return { files: component ? applyRemoteOverlay(component, files) : files, source };
}

// Text is normalized like bundled content; other files keep their exact bytes.
async function fetchRemoteFile(url, componentId) {
  const bytes = await fetchRemote(url, componentId, { action: "fetch" });
  const text = decodeText(bytes);
  return text === null ? bytes : normalizeText(text);
}

async function fetchGitHubJson(url, componentId) {
  const bytes = await fetchRemote(url, componentId, { action: "resolve", accept: "application/vnd.github+json" });
  return JSON.parse(bytes.toString("utf8"));
}

async function fetchRemote(url, label, { action, accept }) {
  try {
    const response = await fetch(url, {
      headers: { "user-agent": "agent-suitup", ...(accept ? { accept } : {}) },
      signal: AbortSignal.timeout(remoteFetchTimeoutMs),
    });
    if (!response.ok) throw new Error(`Failed to ${action} ${label}: HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  } catch (error) {
    if (error?.name === "TimeoutError") {
      throw new Error(`Timed out after ${remoteFetchTimeoutMs / 1000} seconds while trying to ${action} ${label}`);
    }
    throw error;
  }
}

async function fetchResolvedFiles(descriptors, componentId, { verify = false } = {}) {
  const files = await Promise.all(descriptors.map(async (descriptor) => {
    const content = await fetchRemoteFile(descriptor.resolvedUrl, `${componentId}/${descriptor.path}`);
    if (verify && descriptor.integrity && integrity(content) !== descriptor.integrity) {
      throw new Error(`Pinned remote file failed its checksum: ${componentId}/${descriptor.path}`);
    }
    return { path: descriptor.path, content, mode: descriptor.mode ?? 0o644 };
  }));
  const totalBytes = files.reduce((sum, file) => sum + Buffer.byteLength(file.content), 0);
  if (totalBytes > remotePackageMaxBytes) throw new Error(`Remote package is too large: ${componentId}`);
  return files;
}

function validateRemoteDescriptors(descriptors, componentId) {
  if (!descriptors.length || descriptors.length > remotePackageMaxFiles) {
    throw new Error(`Remote package has an invalid file count: ${componentId}`);
  }
  const paths = new Set();
  let declaredBytes = 0;
  for (const descriptor of descriptors) {
    const relative = normalizePackagePath(descriptor.path, componentId);
    if (paths.has(relative)) throw new Error(`Remote package has a duplicate path: ${componentId}/${relative}`);
    paths.add(relative);
    declaredBytes += descriptor.size ?? 0;
  }
  if (!paths.has("SKILL.md")) throw new Error(`Remote package has no SKILL.md: ${componentId}`);
  if (declaredBytes > remotePackageMaxBytes) throw new Error(`Remote package is too large: ${componentId}`);
}

function applyRemoteOverlay(component, files) {
  if (!component.content?.overlay) return files;
  const overlay = readCatalogText(component.content.overlay, component.id).trim();
  return files.map((file) => file.path === "SKILL.md"
    ? { ...file, content: insertSkillOverlay(file.content, overlay, component.id) }
    : file);
}

function insertSkillOverlay(content, overlay, componentId) {
  const frontmatter = /^---\n[\s\S]*?\n---\n/.exec(content);
  if (!frontmatter) throw new Error(`Remote skill has invalid frontmatter: ${componentId}`);
  const body = content.slice(frontmatter[0].length).replace(/^\n+/, "");
  return `${frontmatter[0]}\n${overlay}\n\n${body}`;
}

function skillFile(remotePackage, componentId) {
  const file = remotePackage.files.find((candidate) => candidate.path === "SKILL.md");
  if (!file) throw new Error(`Remote package has no SKILL.md: ${componentId}`);
  if (typeof file.content !== "string") throw new Error(`Remote SKILL.md is not text: ${componentId}`);
  return file;
}

export function readCatalogText(relative, componentId) {
  const sourcePath = path.resolve(catalogRoot, relative);
  if (sourcePath !== catalogRoot && !sourcePath.startsWith(`${catalogRoot}${path.sep}`)) {
    throw new Error(`Catalog content escapes the package: ${componentId}`);
  }
  return normalizeText(fs.readFileSync(sourcePath, "utf8"));
}

function resolveBundledPath(relative, componentId) {
  const sourcePath = path.resolve(catalogRoot, relative);
  if (sourcePath !== catalogRoot && !sourcePath.startsWith(`${catalogRoot}${path.sep}`)) {
    throw new Error(`Bundled content escapes the package: ${componentId}`);
  }
  return sourcePath;
}

function readBundledDirectory(root, directory, componentId) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...readBundledDirectory(root, absolute, componentId));
    } else if (entry.isFile()) {
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      files.push({
        path: normalizePackagePath(relative, componentId),
        content: normalizeText(fs.readFileSync(absolute, "utf8")),
        mode: (fs.statSync(absolute).mode & 0o111) ? 0o755 : 0o644,
      });
    } else {
      throw new Error(`Bundled package contains an unsupported entry: ${componentId}/${entry.name}`);
    }
  }
  return files;
}

function normalizeRemotePath(value, label) {
  if (typeof value !== "string" || !value || value.includes("\\")) throw new Error(`Invalid ${label}`);
  const normalized = path.posix.normalize(value).replace(/^\.\//, "").replace(/\/$/, "");
  if (!normalized || normalized === "." || normalized.startsWith("../") || path.posix.isAbsolute(normalized)) {
    throw new Error(`Invalid ${label}`);
  }
  return normalized;
}

function normalizePackagePath(value, componentId) {
  const normalized = normalizeRemotePath(value, `${componentId} package path`);
  if (normalized !== value) throw new Error(`Remote package path is not normalized: ${componentId}/${value}`);
  return normalized;
}

function parseGitHubRawUrl(url) {
  const match = /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/.exec(url);
  if (!match) return null;
  return { owner: match[1], repository: match[2], ref: match[3], file: match[4] };
}

export function metadataIntegrity(component) {
  return integrity(stableJson(component));
}

export function suggested(component, detected) {
  const when = component.suggest?.when;
  if (!when) return { pick: false };
  const all = when.all ?? [];
  const any = when.any ?? [];
  const pick = all.every((signal) => Boolean(detected[signal]))
    && (!any.length || any.some((signal) => Boolean(detected[signal])));
  return { pick, ...(pick ? { reason: component.suggest.reason } : {}) };
}

export function componentContextCost(component) {
  if (!component.context || component.context.loading === "none") {
    return { words: 0, estimatedTokens: 0 };
  }
  if (component.content?.kind === "bundled") {
    const content = bundledContent(component);
    return {
      words: countWords(content),
      estimatedTokens: Math.ceil(Buffer.byteLength(normalizeText(content), "utf8") / 4),
    };
  }
  return {
    words: null,
    estimatedTokens: component.context.estimatedTokens,
  };
}

export function aggregateContextCost(components) {
  return components
    .filter((component) => component.context?.loading === "always")
    .reduce((total, component) => {
      const cost = componentContextCost(component);
      return {
        words: total.words + (cost.words ?? 0),
        estimatedTokens: total.estimatedTokens + (cost.estimatedTokens ?? 0),
      };
    }, { words: 0, estimatedTokens: 0 });
}

export function countWords(content) {
  const normalized = normalizeText(content).trim();
  return normalized ? normalized.split(/\s+/u).length : 0;
}

export function missingPrerequisiteCommands(component) {
  return (component.requires?.commands ?? []).filter((command) => !commandAvailable(command));
}

export function catalogConflicts(components) {
  const selected = new Set(components.map(({ id }) => id));
  const conflicts = new Set();
  for (const component of components) {
    for (const other of component.conflictsWith ?? []) {
      if (!selected.has(other)) continue;
      conflicts.add([component.id, other].sort().join(" <> "));
    }
  }
  return [...conflicts].sort();
}

export function validateCatalogComponent(component, ids = new Set()) {
  const id = component?.id ?? "<missing>";
  if (!component || typeof component !== "object" || !component.id || ids.has(component.id)) {
    throw new Error(`Invalid or duplicate catalog component: ${id}`);
  }
  assertKeys(component, catalogKeys.component, "catalog component", id);
  if (!supportedKinds.has(component.kind) || !component.id.startsWith(`${component.kind}/`)) {
    throw new Error(`Catalog kind and ID disagree: ${component.id}`);
  }
  if (!componentIdPattern.test(component.id)) {
    throw new Error(`Invalid catalog component ID: ${component.id}`);
  }
  if (!/^\d+\.\d+\.\d+$/.test(component.version ?? "")) {
    throw new Error(`Invalid catalog component version: ${component.id}`);
  }
  for (const field of ["name", "category", "description"]) {
    if (!isText(component[field])) {
      throw new Error(`Catalog component must declare ${field}: ${component.id}`);
    }
  }
  for (const field of ["outcome", "alwaysOnJustification", "license"]) {
    if (component[field] !== undefined && !isText(component[field])) {
      throw new Error(`Catalog component ${field} must be nonempty text: ${component.id}`);
    }
  }
  if (component.selection !== undefined) {
    assertKeys(component.selection, catalogKeys.selection, "selection guide", id);
    for (const field of ["when", "consider", "example"]) {
      if (!isText(component.selection[field])) {
        throw new Error(`Catalog selection guide must declare ${field}: ${component.id}`);
      }
    }
  }
  if (!Array.isArray(component.scopes) || !component.scopes.length
    || new Set(component.scopes).size !== component.scopes.length
    || component.scopes.some((scope) => !supportedScopes.has(scope))) {
    throw new Error(`Invalid scopes for catalog component: ${component.id}`);
  }
  if (component.recommendedScope !== undefined && !component.scopes.includes(component.recommendedScope)) {
    throw new Error(`Recommended scope is not supported: ${component.id}`);
  }
  validateAdapters(component);
  validateContext(component);
  validateContent(component);
  validateSuggestion(component);
  validateRequirements(component);
  if (component.conflictsWith !== undefined
    && (!Array.isArray(component.conflictsWith)
      || new Set(component.conflictsWith).size !== component.conflictsWith.length
      || component.conflictsWith.includes(component.id)
      || component.conflictsWith.some((other) => !componentIdPattern.test(other)))) {
    throw new Error(`Invalid component conflicts: ${component.id}`);
  }
  if (component.kind === "block") {
    if (component.scopes.length !== 1 || component.scopes[0] !== "project") {
      throw new Error(`Instruction block must use project scope: ${component.id}`);
    }
    if (component.context?.loading !== "always") {
      throw new Error(`Instruction block must always load: ${component.id}`);
    }
    for (const field of ["outcome", "alwaysOnJustification"]) {
      if (!isText(component[field])) {
        throw new Error(`Instruction block must declare ${field}: ${component.id}`);
      }
    }
    if (!bundledContent(component).trim()) {
      throw new Error(`Instruction block must contain guidance: ${component.id}`);
    }
  }
  if (component.kind === "plugin") {
    validatePluginAdapter(component);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(component.lastVerified ?? "")) {
      throw new Error(`Plugin must declare lastVerified: ${component.id}`);
    }
    if (component.adapters.length !== 1 || component.adapters[0] !== "claude") {
      throw new Error(`Claude plugin must declare only the Claude adapter: ${component.id}`);
    }
    if (component.content || component.context) {
      throw new Error(`Plugin context is owned by its marketplace package: ${component.id}`);
    }
  } else if (component.adapter || component.lastVerified) {
    throw new Error(`Portable component cannot declare plugin metadata: ${component.id}`);
  }
  ids.add(component.id);
  return component;
}

function validatePluginAdapter(component) {
  const claude = component.adapter?.claude;
  if (!claude?.pluginId || !claude.marketplace?.name || !claude.marketplace?.repo) {
    throw new Error(`Claude plugin metadata is incomplete: ${component.id}`);
  }
  assertKeys(component.adapter, catalogKeys.adapter, "plugin adapter", component.id);
  assertKeys(claude, catalogKeys.claudeAdapter, "Claude plugin adapter", component.id);
  assertKeys(claude.marketplace, catalogKeys.marketplace, "Claude marketplace", component.id);
  if (!slugPattern.test(claude.pluginId) || !slugPattern.test(claude.marketplace.name)
    || !/^[^/]+\/[^/]+$/.test(claude.marketplace.repo)) {
    throw new Error(`Invalid Claude plugin metadata: ${component.id}`);
  }
}

function validateAdapters(component) {
  if (component.adapters && (!Array.isArray(component.adapters)
    || !component.adapters.length
    || new Set(component.adapters).size !== component.adapters.length
    || component.adapters.some((adapter) => !supportedCatalogAdapters.has(adapter)))) {
    throw new Error(`Invalid adapters for catalog component: ${component.id}`);
  }
  if (component.kind === "plugin" && !component.adapters) {
    throw new Error(`Adapter-specific component must declare adapters: ${component.id}`);
  }
  if (component.kind !== "plugin" && component.adapters) {
    throw new Error(`Portable component cannot declare adapters: ${component.id}`);
  }
}

function validateContext(component) {
  if (component.context !== undefined) {
    assertKeys(component.context, catalogKeys.context, "context", component.id);
  }
  if (new Set(["block", "skill", "command"]).has(component.kind)) {
    if (!component.context || !supportedLoading.has(component.context.loading)) {
      throw new Error(`Component must declare a valid context loading mode: ${component.id}`);
    }
  }
  if (component.content?.kind === "remote"
    && !Number.isInteger(component.context?.estimatedTokens)) {
    throw new Error(`Remote component must declare an estimated context cost: ${component.id}`);
  }
  if (component.context?.estimatedTokens !== undefined
    && (!Number.isInteger(component.context.estimatedTokens) || component.context.estimatedTokens < 0)) {
    throw new Error(`Invalid estimated context cost: ${component.id}`);
  }
  if (component.content?.kind === "bundled" && component.context?.estimatedTokens !== undefined) {
    throw new Error(`Bundled context cost must be derived from content: ${component.id}`);
  }
}

function validateContent(component) {
  const { content } = component;
  if (new Set(["block", "skill", "command"]).has(component.kind)
    && !new Set(["bundled", "remote"]).has(content?.kind)) {
    throw new Error(`Component must declare bundled or remote content: ${component.id}`);
  }
  if (content === undefined) return;
  assertKeys(content, content.kind === "remote" ? catalogKeys.remoteContent : catalogKeys.bundledContent,
    "content", component.id);
  for (const field of ["path", "root", "upstream", "overlay", "licensePath", "licenseTarget"]) {
    if (content[field] !== undefined && !isText(content[field])) {
      throw new Error(`Invalid content ${field}: ${component.id}`);
    }
  }
  if (content.kind === "bundled" && !content.path) {
    throw new Error(`Bundled component must declare a path: ${component.id}`);
  }
  if (content.kind === "remote") validateRemoteSource(component);
  if (content.revision !== undefined && !/^[0-9a-f]{40}$/i.test(content.revision)) {
    throw new Error(`Bundled attribution revision must be immutable: ${component.id}`);
  }
  if (!component.license) {
    throw new Error(`Component content must declare a license: ${component.id}`);
  }
}

function validateRemoteSource(component) {
  const { url, upstream, root, overlay } = component.content;
  if (!url || !upstream) throw new Error(`Remote component source is incomplete: ${component.id}`);
  const github = parseGitHubRawUrl(url);
  if (!github || !/^[0-9a-f]{40}$/i.test(github.ref)) {
    throw new Error(`Remote content must be pinned to an immutable GitHub revision: ${component.id}`);
  }
  if (root !== undefined && github.file !== `${normalizeRemotePath(root, `${component.id} root`)}/SKILL.md`) {
    throw new Error(`Remote skill URL must point to its declared root SKILL.md: ${component.id}`);
  }
  if (overlay !== undefined) readCatalogText(overlay, component.id);
}

function validateSuggestion(component) {
  if (!component.suggest) return;
  assertKeys(component.suggest, catalogKeys.suggest, "suggestion", component.id);
  const { when, reason } = component.suggest;
  const ruleKeys = Object.keys(when ?? {});
  if (!when || typeof when !== "object" || Array.isArray(when)
    || (!Array.isArray(when.all) && !Array.isArray(when.any))
    || ruleKeys.some((key) => !catalogKeys.suggestWhen.has(key))
    || [when.all, when.any].filter(Boolean).some((signals) => !signals.length
      || new Set(signals).size !== signals.length)
    || [...(when.all ?? []), ...(when.any ?? [])].some((signal) => typeof signal !== "string" || !signal)
    || !isText(reason)) {
    throw new Error(`Invalid suggestion rule: ${component.id}`);
  }
}

function validateRequirements(component) {
  if (!component.requires) return;
  assertKeys(component.requires, catalogKeys.requires, "requirements", component.id);
  const commands = component.requires.commands;
  if (!Array.isArray(commands) || !commands.length || new Set(commands).size !== commands.length
    || commands.some((command) => typeof command !== "string" || !/^[a-zA-Z0-9._-]+$/.test(command))) {
    throw new Error(`Invalid command prerequisites: ${component.id}`);
  }
}

function assertKeys(value, allowed, label, id) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid ${label}: ${id}`);
  }
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw new Error(`Unknown ${label} field ${unknown.join(", ")}: ${id}`);
}

function isText(value) {
  return typeof value === "string" && Boolean(value.trim());
}

export { catalogPath, catalogRoot, packageRoot };
