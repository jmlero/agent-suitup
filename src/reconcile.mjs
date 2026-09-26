import fs from "node:fs";
import path from "node:path";
import { agentNames } from "./agents.mjs";
import { ClaudeSettingsEditor } from "./adapters/claude.mjs";
import { commandBridge, commandBridgeAgents } from "./adapters/commands.mjs";
import {
  bundledPackage,
  bundledContent,
  catalogConflicts,
  getComponent,
  lockedRemotePackage,
  metadataIntegrity,
  missingPrerequisiteCommands,
  requireComponent,
  resolveRemotePackage,
} from "./catalog.mjs";
import { integrity, normalizeText, sameContent } from "./integrity.mjs";
import { managedPayload, removeManagedBlock, upsertManagedBlock } from "./managed.mjs";
import { ConflictError, Planner } from "./planner.mjs";
import { portablePath, resolvePortablePath } from "./paths.mjs";

// Blocks live in one owned rules file. AGENTS.md, which every supported agent
// reads, carries a single managed line pointing to it. Claude Code expands the
// @ import at session start; Codex and Grok open the file when told to.
export const rulesFile = ".agents/rules.md";
export const rulesLinkId = "rules";
export const rulesLink = `Project rules: read and follow @${rulesFile} before starting any task.`;
const claudeInstructionFiles = ["CLAUDE.md", ".claude/CLAUDE.md", "CLAUDE.local.md"];

export async function reconcile({
  cwd,
  home,
  manifest,
  previousLock,
  force = false,
  refreshRemote = false,
}) {
  const selectedComponents = manifest.components.map(({ id }) => requireComponent(id));
  const conflicts = catalogConflicts(selectedComponents);
  if (conflicts.length) throw new Error(`Selected components conflict: ${conflicts.join(", ")}`);
  const planner = new Planner({ cwd, home, force });
  const claude = new ClaudeSettingsEditor({ cwd, home, previousLock });
  const nextLock = { lockfileVersion: 1, components: {} };
  const desiredIds = new Set(manifest.components.map(({ id }) => id));
  const missingPrerequisites = [];
  // Decided before any write, so every block records who created the shared files.
  const shared = {
    rulesCreated: sharedFileCreated(previousLock, path.join(cwd, rulesFile), planner),
    linkCreated: sharedFileCreated(previousLock, path.join(cwd, "AGENTS.md"), planner),
  };

  for (const selection of manifest.components) {
    const component = requireComponent(selection.id);
    validateSelection(component, selection, manifest.adapters);
    const previous = previousLock.components[component.id];
    const missingCommands = missingPrerequisiteCommands(component);
    if (missingCommands.length) {
      // Only new selections are refused; an installed component that loses an
      // executable must not block unrelated work for everyone sharing the manifest.
      if (!previous) {
        throw new Error(`${component.id} requires commands that are not available: ${missingCommands.join(", ")}`);
      }
      missingPrerequisites.push({ id: component.id, commands: missingCommands });
      planner.note(`${component.id}: install ${missingCommands.join(", ")} (required on PATH, not found)`);
    }
    const entry = await installComponent({
      component,
      selection,
      adapters: component.adapters
        ? manifest.adapters.filter((adapter) => component.adapters.includes(adapter))
        : manifest.adapters,
      previous,
      planner,
      claude,
      cwd,
      home,
      force,
      refreshRemote,
      shared,
    });
    removeStaleFiles(previous, entry, planner);
    nextLock.components[component.id] = entry;
  }

  for (const [id, previous] of Object.entries(previousLock.components)) {
    if (desiredIds.has(id)) continue;
    uninstallComponent({ id, previous, component: getComponent(id), planner, claude, cwd, home, force });
  }

  syncRulesLink({ planner, cwd, force, previousLock, nextLock, shared });
  if (manifest.adapters.includes("claude") && Object.values(nextLock.components).some(({ kind }) => kind === "block")) {
    noteShadowedInstructions(planner, cwd);
  }
  claude.flush(planner);
  return { planner, lock: nextLock, missingPrerequisites };
}

async function installComponent(context) {
  const { component, selection, adapters, previous } = context;
  const entry = {
    kind: component.kind,
    version: component.version,
    source: lockSource(component),
    metadataIntegrity: metadataIntegrity(component),
    scope: selection.scope,
    adapters,
    files: [],
  };

  if (component.kind === "block") {
    const content = bundledContent(component);
    entry.integrity = integrity(content);
    installBlock(context, entry, content);
  } else if (new Set(["skill", "command"]).has(component.kind)) {
    const resolved = await resolveSkillPackage(context);
    if (resolved.source) entry.source = resolved.source;
    entry.integrity = skillPackageIntegrity(resolved.files);
    installSkill(context, entry, resolved.files);
  } else if (component.kind === "plugin") {
    entry.integrity = entry.metadataIntegrity;
    installPlugin(context, entry);
  }

  if (previous && previous.scope !== selection.scope && component.kind === "plugin") {
    context.claude.disablePluginAdapter(previous.adapter, previous.scope);
  }
  return entry;
}

function installBlock({ component, previous, planner, cwd, force, shared }, entry, content) {
  const file = path.join(cwd, rulesFile);
  const document = textDocument(planner, file);
  const payload = managedPayload(document, component.id);
  if (payload) {
    const expected = previous?.integrity ?? entry.integrity;
    if (integrity(payload) !== expected && !force) {
      throw new ConflictError(`Managed block has local changes: ${component.id}`);
    }
  }
  // Earlier releases embedded blocks in AGENTS.md; move them to the rules file.
  for (const record of previous?.files ?? []) {
    const recorded = resolvePortablePath(record.path, planner);
    if (record.kind === "block" && recorded !== file) removeBlockSegment(component.id, previous, recorded, planner, force);
  }
  planner.write(file, upsertManagedBlock(textDocument(planner, file), component, content), { allowExisting: true });
  entry.files.push(fileRecord(file, "block", planner, {
    id: component.id,
    integrity: entry.integrity,
    created: shared.rulesCreated,
  }));
}

function installSkill({ component, selection, adapters, previous, planner, cwd, home }, entry, files) {
  const name = componentName(component);
  const root = selection.scope === "user" ? home : cwd;
  const canonicalDirectory = path.join(root, ".agents", "skills", name);
  for (const skillFile of files) {
    const canonical = skillPath(canonicalDirectory, skillFile.path, component.id);
    const previousFile = findFile(previous, canonical, planner);
    const current = planner.state(canonical);
    const fileIntegrity = integrity(skillFile.content);
    planner.write(canonical, skillFile.content, {
      mode: skillFile.mode ?? 0o644,
      owned: Boolean(previousFile) || (current.kind === "file" && sameContent(current.content, skillFile.content)),
      expectedIntegrity: previousFile?.integrity,
    });
    entry.files.push(fileRecord(canonical, "file", planner, {
      integrity: fileIntegrity,
      created: previousFile?.created ?? current.kind === "missing",
      ...(skillFile.mode === 0o755 ? { executable: true } : {}),
    }));
  }

  if (adapters.includes("claude") && component.kind !== "command") {
    const claudeSkill = path.join(root, ".claude", "skills", name);
    const previousBridge = findFile(previous, claudeSkill, planner);
    if (process.platform === "win32") {
      for (const skillFile of files) {
        const bridgeFile = skillPath(claudeSkill, skillFile.path, component.id);
        const previousCopy = findFile(previous, bridgeFile, planner);
        const copyState = planner.state(bridgeFile);
        planner.write(bridgeFile, skillFile.content, {
          mode: skillFile.mode ?? 0o644,
          owned: Boolean(previousCopy) || (copyState.kind === "file" && sameContent(copyState.content, skillFile.content)),
          expectedIntegrity: previousCopy?.integrity,
        });
        entry.files.push(fileRecord(bridgeFile, "file", planner, {
          integrity: integrity(skillFile.content),
          created: previousCopy?.created ?? copyState.kind === "missing",
          fallbackCopy: true,
          ...(skillFile.mode === 0o755 ? { executable: true } : {}),
        }));
      }
    } else {
      const target = path.relative(path.dirname(claudeSkill), canonicalDirectory);
      const bridgeState = planner.state(claudeSkill);
      planner.symlink(claudeSkill, target, {
        linkType: "dir",
        owned: Boolean(previousBridge) || (bridgeState.kind === "symlink" && bridgeState.target === target),
        expectedTarget: previousBridge?.target,
      });
      entry.files.push(fileRecord(claudeSkill, "symlink", planner, {
        target,
        created: previousBridge?.created ?? bridgeState.kind === "missing",
      }));
    }
  }

  if (component.kind !== "command") return;
  for (const agent of commandBridgeAgents.filter((candidate) => adapters.includes(candidate))) {
    const bridge = commandBridge({
      agent,
      component,
      scope: selection.scope,
      cwd,
      home,
      canonical: path.join(canonicalDirectory, "SKILL.md"),
    });
    // Earlier Claude adapters linked the whole canonical folder here. Replace
    // that link instead of writing the wrapper through it.
    const directory = path.dirname(bridge.file);
    const link = planner.state(directory);
    if (link.kind === "symlink") {
      const previousLink = findFile(previous, directory, planner);
      planner.delete(directory, {
        owned: Boolean(previousLink) || link.target === path.relative(path.dirname(directory), canonicalDirectory),
        expectedKind: "symlink",
        expectedTarget: previousLink?.target,
      });
    }
    const previousBridge = findFile(previous, bridge.file, planner);
    const current = planner.state(bridge.file);
    planner.write(bridge.file, bridge.content, {
      owned: Boolean(previousBridge) || (current.kind === "file" && current.content === bridge.content),
      expectedIntegrity: previousBridge?.integrity,
    });
    entry.files.push(fileRecord(bridge.file, "file", planner, {
      integrity: integrity(bridge.content),
      created: previousBridge?.created ?? current.kind === "missing",
      [`${agent}CommandBridge`]: true,
    }));
  }
}

function installPlugin({ component, selection, claude }, entry) {
  const marketplaceCreated = claude.enablePlugin(component, selection.scope);
  entry.adapter = component.adapter;
  if (marketplaceCreated) entry.marketplaceCreated = true;
}

async function resolveSkillPackage({ component, previous, planner, cwd, home, force, refreshRemote, selection }) {
  if (component.content.kind === "bundled") {
    return { files: bundledPackage(component) };
  }

  const name = componentName(component);
  const root = selection.scope === "user" ? home : cwd;
  const canonicalDirectory = path.join(root, ".agents", "skills", name);
  if (!refreshRemote && previous) {
    const local = selection.scope === previous.scope
      ? localSkillPackage(previous, canonicalDirectory, planner, force)
      : null;
    if (local) return { files: local, source: previous.source };

    const resolved = await lockedRemotePackage(component, previous.source);
    if (!matchesPreviousSkillIntegrity(resolved.files, previous.integrity)) {
      throw new ConflictError(`Pinned remote content failed its checksum: ${component.id}`);
    }
    return resolved;
  }
  return resolveRemotePackage(component);
}

function uninstallComponent({ id, previous, component, planner, claude, cwd, home, force }) {
  if (previous.kind === "block") {
    uninstallBlock(id, previous, planner, force);
  } else {
    removeFiles(previous.files, planner);
  }

  if (previous.kind === "plugin") {
    if (previous.adapter) claude.disablePluginAdapter(previous.adapter, previous.scope);
    else if (component) claude.disablePlugin(component, previous.scope);
    else planner.note(`${id}: remove its Claude enabledPlugins entry manually; it is no longer in the catalog`);
  }
}

function uninstallBlock(id, previous, planner, force) {
  for (const record of previous.files ?? []) {
    if (record.kind === "block") removeBlockSegment(id, previous, resolvePortablePath(record.path, planner), planner, force);
  }
}

function removeBlockSegment(id, previous, file, planner, force) {
  const current = planner.state(file);
  if (current.kind === "missing") return;
  if (current.kind !== "file") throw new ConflictError(`Managed file changed type: ${planner.label(file)}`);
  assertTextDocument(current, file, planner);
  const payload = managedPayload(current.content, id);
  if (!payload) return;
  if (integrity(payload) !== previous.integrity && !force) {
    throw new ConflictError(`Managed block has local changes: ${id}`);
  }
  planner.write(file, removeManagedBlock(current.content, id), { allowExisting: true });
}

// Adds the AGENTS.md link while any block is installed and removes it with the
// last one. Shared files agent-suitup created are deleted once they are empty.
function syncRulesLink({ planner, cwd, force, previousLock, nextLock, shared }) {
  const file = path.join(cwd, "AGENTS.md");
  const blocks = Object.values(nextLock.components).filter(({ kind }) => kind === "block");
  const document = textDocument(planner, file);
  const payload = managedPayload(document, rulesLinkId);
  const recorded = Object.values(previousLock.components).flatMap((entry) => entry.files ?? [])
    .find((record) => record.kind === "link")?.integrity;
  const expected = integrity(normalizeText(rulesLink));
  if (payload && ![recorded ?? expected, expected].includes(integrity(payload)) && !force) {
    throw new ConflictError("Managed block has local changes: AGENTS.md link to the rules file");
  }
  if (blocks.length) {
    planner.write(file, upsertManagedBlock(document, { id: rulesLinkId }, rulesLink), { allowExisting: true });
    for (const entry of blocks) {
      entry.files.push(fileRecord(file, "link", planner, { integrity: expected, created: shared.linkCreated }));
    }
  } else if (payload) {
    planner.write(file, removeManagedBlock(document, rulesLinkId), { allowExisting: true });
  }
  for (const [target, created] of [[path.join(cwd, rulesFile), shared.rulesCreated], [file, shared.linkCreated]]) {
    const current = planner.state(target);
    if (created && current.kind === "file" && typeof current.content === "string" && !current.content.trim()) {
      planner.delete(target, { owned: true, expectedKind: "file", pruneBelow: cwd });
    }
  }
}

// Claude Code reads CLAUDE.md instead of AGENTS.md when both exist, unless
// CLAUDE.md imports it.
function noteShadowedInstructions(planner, cwd) {
  const present = claudeInstructionFiles.filter((name) => {
    const file = path.join(cwd, name);
    return fs.existsSync(file) && fs.statSync(file).isFile();
  });
  if (!present.length) return;
  const imports = present.some((name) => /(^|\s)@(\.\/)?(AGENTS\.md|\.agents\/rules\.md)(\s|$)/m
    .test(fs.readFileSync(path.join(cwd, name), "utf8")));
  if (!imports) {
    planner.note(`Claude Code reads ${present.join(" and ")} instead of AGENTS.md, so it skips ${rulesFile}; add a line with @AGENTS.md to ${present[0]}`);
  }
}

// Whether agent-suitup created a file every block shares, such as AGENTS.md.
function sharedFileCreated(previousLock, file, planner) {
  const encoded = portablePath(file, planner);
  const records = Object.values(previousLock.components)
    .filter((entry) => entry.kind === "block")
    .flatMap((entry) => entry.files ?? [])
    .filter((record) => record.path === encoded);
  return records.length ? records.some((record) => record.created) : planner.state(file).kind === "missing";
}

function textDocument(planner, file) {
  const current = planner.state(file);
  if (!new Set(["missing", "file"]).has(current.kind)) {
    throw new ConflictError(`Cannot manage ${planner.label(file)}: it is a ${current.kind}`);
  }
  assertTextDocument(current, file, planner);
  return current.kind === "file" ? current.content : "";
}

function assertTextDocument(current, file, planner) {
  if (current.kind === "file" && typeof current.content !== "string") {
    throw new ConflictError(`Cannot manage ${planner.label(file)}: it is not UTF-8 text`);
  }
}

function removeStaleFiles(previous, next, planner) {
  if (!previous?.files) return;
  const desired = new Set(next.files.map(({ path: file }) => file));
  removeFiles(previous.files.filter((file) => !sharedKinds.has(file.kind) && !desired.has(file.path)), planner);
}

// Records of managed segments in shared documents, not files of their own.
const sharedKinds = new Set(["block", "link"]);

function removeFiles(files = [], planner) {
  for (const record of files) {
    if (sharedKinds.has(record.kind)) continue;
    const file = resolvePortablePath(record.path, planner);
    // An adopted file existed before installation, so removal leaves it to its owner.
    if (record.created === false) {
      if (planner.state(file).kind !== "missing") {
        planner.note(`${record.path}: kept because it existed before installation; delete it manually if no longer needed`);
      }
      continue;
    }
    planner.delete(file, {
      owned: true,
      expectedKind: record.kind,
      expectedIntegrity: record.integrity,
      expectedTarget: record.target,
      pruneBelow: skillsDirectory(file),
    });
  }
}

// The agent's skills folder holding a managed file, such as ~/.agents/skills.
function skillsDirectory(file) {
  for (let directory = path.dirname(file); directory !== path.dirname(directory); directory = path.dirname(directory)) {
    if (path.basename(directory) === "skills"
      && [".agents", ".claude", ".grok"].includes(path.basename(path.dirname(directory)))) return directory;
  }
  return undefined;
}

function validateSelection(component, selection, adapters) {
  if (!component.scopes.includes(selection.scope)) {
    throw new Error(`${component.id} does not support ${selection.scope} scope`);
  }
  if (component.adapters
    && !adapters.some((adapter) => component.adapters.includes(adapter))) {
    throw new Error(`${component.id} requires ${agentNames(component.adapters).join(" or ")} (--agent ${component.adapters.join(",")})`);
  }
}

function lockSource(component) {
  if (component.content?.kind === "bundled") {
    return {
      kind: "bundled",
      path: component.content.path,
      ...(component.content.upstream ? { upstream: component.content.upstream } : {}),
      ...(component.content.revision ? { revision: component.content.revision } : {}),
    };
  }
  if (component.content?.kind === "remote") {
    return {
      kind: "remote",
      url: component.content.url,
      upstream: component.content.upstream,
    };
  }
  if (component.kind === "plugin") return { kind: "adapter", adapter: "claude" };
  return { kind: "catalog" };
}

function fileRecord(file, kind, planner, properties = {}) {
  return { path: portablePath(file, planner), kind, ...properties };
}

function findFile(previous, file, planner) {
  const encoded = portablePath(file, planner);
  return previous?.files?.find((candidate) => candidate.path === encoded);
}

function localSkillPackage(previous, canonicalDirectory, planner, force) {
  const records = (previous.files ?? []).filter((record) => {
    if (record.kind !== "file" || record.fallbackCopy) return false;
    const absolute = resolvePortablePath(record.path, planner);
    const relative = path.relative(canonicalDirectory, absolute);
    return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
  });
  if (!records.length) return null;

  const files = [];
  for (const record of records) {
    const absolute = resolvePortablePath(record.path, planner);
    const current = planner.state(absolute);
    if (current.kind === "missing") return null;
    if (current.kind !== "file") {
      if (!force) throw new ConflictError(`Managed file changed type: ${planner.label(absolute)}`);
      return null;
    }
    if (record.integrity && integrity(current.content) !== record.integrity && !force) {
      throw new ConflictError(`Managed file has local changes: ${planner.label(absolute)}`);
    }
    files.push({
      path: path.relative(canonicalDirectory, absolute).split(path.sep).join("/"),
      content: typeof current.content === "string" ? normalizeText(current.content) : current.content,
      mode: current.mode & 0o111 ? 0o755 : 0o644,
    });
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function skillPackageIntegrity(files) {
  const records = files
    .map((file) => ({ path: file.path, integrity: integrity(file.content), mode: file.mode ?? 0o644 }))
    .sort((left, right) => left.path.localeCompare(right.path));
  return integrity(JSON.stringify(records));
}

function matchesPreviousSkillIntegrity(files, expected) {
  if (skillPackageIntegrity(files) === expected) return true;
  return files.length === 1 && files[0].path === "SKILL.md" && integrity(files[0].content) === expected;
}

function skillPath(root, relative, componentId) {
  if (typeof relative !== "string" || !relative || relative.includes("\\")) {
    throw new Error(`Invalid skill package path: ${componentId}`);
  }
  const segments = relative.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`Invalid skill package path: ${componentId}/${relative}`);
  }
  const absolute = path.resolve(root, ...segments);
  if (!absolute.startsWith(`${path.resolve(root)}${path.sep}`)) {
    throw new Error(`Skill package escapes its directory: ${componentId}/${relative}`);
  }
  return absolute;
}

function componentName(component) {
  return component.id.slice(component.kind.length + 1);
}
