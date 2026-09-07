import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { commandAvailable } from "./detect.mjs";
import { integrity, normalizeText, stableJson } from "./integrity.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalogRoot = path.join(packageRoot, "catalog");
const catalogPath = path.join(catalogRoot, "catalog.json");
const remotePackageMaxFiles = 200;
const remotePackageMaxBytes = 2_000_000;
const supportedCatalogAdapters = new Set(["claude", "grok"]);
const supportedKinds = new Set(["block", "skill", "command", "plugin"]);
const supportedScopes = new Set(["project", "user"]);
const supportedLoading = new Set(["always", "on-demand", "explicit", "none"]);

export const retiredComponentIds = new Set([
  "block/ci-failure-triage",
  "block/responsive-ui-verification",
  "skill/ponytail",
  "hook/slim-cli",
  "plugin/terraform",
  "plugin/superpowers",
  "tool/code-review-graph",
  "tool/codegraph",
  "tool/backlog",
]);

let cachedCatalog;

export function loadCatalog() {
  if (cachedCatalog) return cachedCatalog;
  const parsed = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  if (parsed.catalogVersion !== 2 || !Array.isArray(parsed.components)) {
    throw new Error("Unsupported catalog document");
  }
  const ids = new Set();

  for (const component of parsed.components ?? []) {
    validateCatalogComponent(component, ids);
    if (component.content?.kind === "remote" && component.content.root) {
      const github = parseGitHubRawUrl(component.content.url);
      const root = normalizeRemotePath(component.content.root, `${component.id} root`);
      if (!github || github.file !== `${root}/SKILL.md`) {
        throw new Error(`Remote skill URL must point to its declared root SKILL.md: ${component.id}`);
      }
      if (component.content.overlay) readCatalogText(component.content.overlay, component.id);
    }
    ids.add(component.id);
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
    if (retiredComponentIds.has(id)) {
      throw new Error(`Component was retired after catalog review: ${id}. Remove it from existing installations with \`agent-suitup remove ${id}\``);
    }
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
  const github = parseGitHubRawUrl(component.content.url);
  let resolvedUrl = component.content.url;
  let revision = null;
  let treeSha = null;
  if (component.content.mutable) {
    if (!github) throw new Error(`Mutable remote source is not pinnable: ${component.id}`);
    const payload = await fetchGitHubJson(
      `https://api.github.com/repos/${github.owner}/${github.repository}/commits/${encodeURIComponent(github.ref)}`,
      component.id,
    );
    if (!/^[0-9a-f]{40}$/i.test(payload.sha ?? "")) {
      throw new Error(`Failed to resolve an immutable revision for ${component.id}`);
    }
    revision = payload.sha;
    treeSha = payload.commit?.tree?.sha ?? revision;
    resolvedUrl = `https://raw.githubusercontent.com/${github.owner}/${github.repository}/${revision}/${github.file}`;
  }

  if (!component.content.root) {
    const content = await fetchRemoteText(resolvedUrl, component.id);
    return {
      files: [{ path: "SKILL.md", content, mode: 0o644 }],
      source: {
        kind: "remote",
        url: component.content.url,
        resolvedUrl,
        revision,
        upstream: component.content.upstream,
        mutable: Boolean(component.content.mutable),
      },
    };
  }

  if (!github) throw new Error(`Remote directory source is not a GitHub raw URL: ${component.id}`);
  const root = normalizeRemotePath(component.content.root, `${component.id} root`);
  const pinnedRevision = revision ?? github.ref;
  const tree = await fetchGitHubJson(
    `https://api.github.com/repos/${github.owner}/${github.repository}/git/trees/${encodeURIComponent(treeSha ?? pinnedRevision)}?recursive=1`,
    component.id,
  );
  if (tree.truncated) throw new Error(`Remote tree is truncated: ${component.id}`);

  const descriptors = (tree.tree ?? [])
    .filter((entry) => entry.type === "blob" && entry.path.startsWith(`${root}/`))
    .map((entry) => ({
      path: normalizePackagePath(entry.path.slice(root.length + 1), component.id),
      resolvedUrl: `https://raw.githubusercontent.com/${github.owner}/${github.repository}/${pinnedRevision}/${entry.path}`,
      mode: entry.mode === "100755" ? 0o755 : 0o644,
      size: entry.size ?? 0,
    }));

  if (component.content.licensePath) {
    const licensePath = normalizeRemotePath(component.content.licensePath, `${component.id} license path`);
    const treeEntry = (tree.tree ?? []).find((entry) => entry.type === "blob" && entry.path === licensePath);
    if (!treeEntry) throw new Error(`Remote license file not found: ${component.id}`);
    descriptors.push({
      path: normalizePackagePath(component.content.licenseTarget ?? "LICENSE", component.id),
      resolvedUrl: `https://raw.githubusercontent.com/${github.owner}/${github.repository}/${pinnedRevision}/${licensePath}`,
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
      kind: "remote",
      url: component.content.url,
      resolvedUrl,
      revision,
      root,
      upstream: component.content.upstream,
      mutable: Boolean(component.content.mutable),
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
  const content = await fetchRemoteText(source.resolvedUrl, componentId);
  const files = [{ path: "SKILL.md", content, mode: 0o644 }];
  return { files: component ? applyRemoteOverlay(component, files) : files, source };
}

async function fetchRemoteText(url, componentId) {
  const response = await fetch(url, {
    headers: { "user-agent": "agent-suitup" },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${componentId}: HTTP ${response.status}`);
  }
  return normalizeText(await response.text());
}

async function fetchGitHubJson(url, componentId) {
  const response = await fetch(url, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "agent-suitup",
    },
  });
  if (!response.ok) throw new Error(`Failed to resolve ${componentId}: HTTP ${response.status}`);
  return response.json();
}

async function fetchResolvedFiles(descriptors, componentId, { verify = false } = {}) {
  const files = await Promise.all(descriptors.map(async (descriptor) => {
    const content = await fetchRemoteText(descriptor.resolvedUrl, `${componentId}/${descriptor.path}`);
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
  return file;
}

function readCatalogText(relative, componentId) {
  const sourcePath = path.resolve(catalogRoot, relative);
  if (sourcePath !== catalogRoot && !sourcePath.startsWith(`${catalogRoot}${path.sep}`)) {
    throw new Error(`Catalog content escapes the package: ${componentId}`);
  }
  return normalizeText(fs.readFileSync(sourcePath, "utf8"));
}

function resolveBundledPath(relative, componentId) {
  const sourcePath = path.resolve(catalogRoot, relative);
  const allowedRoots = [catalogRoot, path.join(packageRoot, "adapters")];
  if (!allowedRoots.some((root) => sourcePath === root || sourcePath.startsWith(`${root}${path.sep}`))) {
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
  if (!supportedKinds.has(component.kind) || !component.id.startsWith(`${component.kind}/`)) {
    throw new Error(`Catalog kind and ID disagree: ${component.id}`);
  }
  if (!/^(block|skill|command|plugin)\/[a-z0-9][a-z0-9-]*$/.test(component.id)) {
    throw new Error(`Invalid catalog component ID: ${component.id}`);
  }
  if (!/^\d+\.\d+\.\d+$/.test(component.version ?? "")) {
    throw new Error(`Invalid catalog component version: ${component.id}`);
  }
  for (const field of ["name", "category", "description"]) {
    if (typeof component[field] !== "string" || !component[field].trim()) {
      throw new Error(`Catalog component must declare ${field}: ${component.id}`);
    }
  }
  if (component.selection !== undefined) {
    for (const field of ["when", "consider", "example"]) {
      if (typeof component.selection?.[field] !== "string" || !component.selection[field].trim()) {
        throw new Error(`Catalog selection guide must declare ${field}: ${component.id}`);
      }
    }
  }
  if (!Array.isArray(component.scopes) || !component.scopes.length
    || new Set(component.scopes).size !== component.scopes.length
    || component.scopes.some((scope) => !supportedScopes.has(scope))) {
    throw new Error(`Invalid scopes for catalog component: ${component.id}`);
  }
  if (component.recommendedScope && !component.scopes.includes(component.recommendedScope)) {
    throw new Error(`Recommended scope is not supported: ${component.id}`);
  }
  if (Object.hasOwn(component, "targets")) {
    throw new Error(`Catalog component uses legacy target metadata: ${component.id}`);
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
      || component.conflictsWith.some((id) => !/^(block|skill|command|plugin)\/[a-z0-9][a-z0-9-]*$/.test(id)))) {
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
      if (typeof component[field] !== "string" || !component[field].trim()) {
        throw new Error(`Instruction block must declare ${field}: ${component.id}`);
      }
    }
    if (!bundledContent(component).trim()) {
      throw new Error(`Instruction block must contain guidance: ${component.id}`);
    }
  }
  if (component.kind === "plugin") {
    const claude = component.adapter?.claude;
    if (!claude?.pluginId || !claude.marketplace?.name || !claude.marketplace?.repo) {
      throw new Error(`Claude plugin metadata is incomplete: ${component.id}`);
    }
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

function validateAdapters(component) {
  if (component.adapters && (!Array.isArray(component.adapters)
    || !component.adapters.length
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
  if (new Set(["block", "skill", "command"]).has(component.kind)
    && !new Set(["bundled", "remote"]).has(component.content?.kind)) {
    throw new Error(`Component must declare bundled or remote content: ${component.id}`);
  }
  if (component.content?.kind === "bundled" && !component.content.path) {
    throw new Error(`Bundled component must declare a path: ${component.id}`);
  }
  if (component.content?.kind === "remote"
    && (!component.content.url || !component.content.upstream)) {
    throw new Error(`Remote component source is incomplete: ${component.id}`);
  }
  if (component.content?.revision && !/^[0-9a-f]{40}$/i.test(component.content.revision)) {
    throw new Error(`Bundled attribution revision must be immutable: ${component.id}`);
  }
  if (component.content?.upstream && !component.license) {
    throw new Error(`Attributed content must declare a license: ${component.id}`);
  }
}

function validateSuggestion(component) {
  if (!component.suggest) return;
  const { when, reason } = component.suggest;
  const ruleKeys = Object.keys(when ?? {});
  if (!when || typeof when !== "object" || Array.isArray(when)
    || (!Array.isArray(when.all) && !Array.isArray(when.any))
    || ruleKeys.some((key) => !new Set(["all", "any"]).has(key))
    || [when.all, when.any].filter(Boolean).some((signals) => !signals.length
      || new Set(signals).size !== signals.length)
    || [...(when.all ?? []), ...(when.any ?? [])].some((signal) => typeof signal !== "string" || !signal)
    || typeof reason !== "string" || !reason.trim()) {
    throw new Error(`Invalid suggestion rule: ${component.id}`);
  }
}

function validateRequirements(component) {
  if (!component.requires) return;
  const commands = component.requires.commands;
  if (!Array.isArray(commands) || !commands.length
    || commands.some((command) => typeof command !== "string" || !/^[a-zA-Z0-9._-]+$/.test(command))) {
    throw new Error(`Invalid command prerequisites: ${component.id}`);
  }
}

export { catalogPath, catalogRoot, packageRoot };
