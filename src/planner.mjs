import fs from "node:fs";
import path from "node:path";
import { integrity } from "./integrity.mjs";
import { portablePath } from "./paths.mjs";

export class ConflictError extends Error {}

export class Planner {
  constructor({ cwd, home, force = false }) {
    this.cwd = cwd;
    this.home = home;
    this.force = force;
    this.changes = new Map();
    this.virtual = new Map();
    this.notes = [];
  }

  state(file) {
    const absolute = path.resolve(file);
    return this.virtual.has(absolute) ? this.virtual.get(absolute) : readState(absolute);
  }

  write(file, content, options = {}) {
    const absolute = path.resolve(file);
    const current = this.state(absolute);
    const mode = options.mode ?? 0o644;
    const sameMode = current.kind === "file" && (current.mode & 0o777) === mode;
    if (current.kind === "file" && current.content === content && sameMode) return;

    if (current.kind !== "missing" && current.kind !== "file") {
      throw new ConflictError(`Cannot write ${this.label(absolute)}: it is a ${current.kind}`);
    }
    this.assertOwnedFile(current, absolute, options);
    this.setChange(absolute, { kind: "write", content, mode }, current);
  }

  symlink(file, target, options = {}) {
    const absolute = path.resolve(file);
    const current = this.state(absolute);
    if (current.kind === "symlink" && current.target === target) return;
    if (current.kind === "directory") {
      throw new ConflictError(`Refusing to replace directory ${this.label(absolute)}`);
    }
    if (current.kind !== "missing") {
      if (!options.owned && !this.force) {
        throw new ConflictError(`Refusing to replace unmanaged ${this.label(absolute)}`);
      }
      if (options.expectedTarget && current.kind === "symlink"
        && current.target !== options.expectedTarget && !this.force) {
        throw new ConflictError(`Managed symlink drifted: ${this.label(absolute)}`);
      }
      if (current.kind !== "symlink" && !this.force) {
        throw new ConflictError(`Managed path changed type: ${this.label(absolute)}`);
      }
    }
    this.setChange(absolute, { kind: "symlink", target, linkType: options.linkType ?? "file" }, current);
  }

  delete(file, options = {}) {
    const absolute = path.resolve(file);
    const current = this.state(absolute);
    if (current.kind === "missing") return;
    if (current.kind === "directory") {
      throw new ConflictError(`Refusing to delete directory ${this.label(absolute)}`);
    }
    if (!options.owned && !this.force) {
      throw new ConflictError(`Refusing to remove unmanaged ${this.label(absolute)}`);
    }
    if (options.expectedKind && current.kind !== options.expectedKind && !this.force) {
      throw new ConflictError(`Managed path changed type: ${this.label(absolute)} (expected ${options.expectedKind}, found ${current.kind})`);
    }
    if (current.kind === "file" && options.expectedIntegrity
      && integrity(current.content) !== options.expectedIntegrity && !this.force) {
      throw new ConflictError(`Managed file has local changes: ${this.label(absolute)}`);
    }
    if (current.kind === "symlink" && options.expectedTarget
      && current.target !== options.expectedTarget && !this.force) {
      throw new ConflictError(`Managed symlink drifted: ${this.label(absolute)}`);
    }
    this.setChange(absolute, { kind: "missing" }, current);
  }

  note(message) {
    if (!this.notes.includes(message)) this.notes.push(message);
  }

  operations() {
    return [...this.changes.values()].sort((left, right) => left.label.localeCompare(right.label));
  }

  hasChanges() {
    return this.changes.size > 0;
  }

  label(file) {
    return portablePath(file, this);
  }

  apply() {
    const operations = this.operations();
    // Check the whole change set before writing any content or stored state.
    for (const operation of operations) {
      if (!sameState(operation.before, readState(operation.path))) {
        throw new ConflictError(`Path changed after planning: ${operation.label}. Rerun the command to review current files.`);
      }
    }
    for (const operation of operations) {
      const parent = path.dirname(operation.path);
      if (operation.after.kind === "write") {
        fs.mkdirSync(parent, { recursive: true });
        const temporary = path.join(parent, `.${path.basename(operation.path)}.agent-suitup-${process.pid}`);
        try {
          fs.writeFileSync(temporary, operation.after.content, { mode: operation.after.mode });
          fs.renameSync(temporary, operation.path);
          fs.chmodSync(operation.path, operation.after.mode);
        } finally {
          if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
        }
      } else if (operation.after.kind === "symlink") {
        fs.mkdirSync(parent, { recursive: true });
        try {
          fs.unlinkSync(operation.path);
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
        fs.symlinkSync(operation.after.target, operation.path, operation.after.linkType);
      } else if (operation.after.kind === "missing") {
        fs.unlinkSync(operation.path);
      }
    }
  }

  assertOwnedFile(current, absolute, options) {
    if (current.kind === "missing" || options.allowExisting) return;
    if (!options.owned && !this.force) {
      throw new ConflictError(`Refusing to overwrite unmanaged ${this.label(absolute)}`);
    }
    if (options.expectedIntegrity && integrity(current.content) !== options.expectedIntegrity && !this.force) {
      throw new ConflictError(`Managed file has local changes: ${this.label(absolute)}`);
    }
  }

  setChange(absolute, after, current) {
    const existing = this.changes.get(absolute);
    const before = existing?.before ?? current;
    const virtual = materializedState(after);
    this.virtual.set(absolute, virtual);
    if (sameState(before, virtual)) {
      this.changes.delete(absolute);
      return;
    }
    this.changes.set(absolute, {
      path: absolute,
      label: this.label(absolute),
      before,
      after,
    });
  }
}

function materializedState(operation) {
  if (operation.kind === "write") {
    return { kind: "file", content: operation.content, mode: operation.mode };
  }
  return operation;
}

export function formatPlan(planner) {
  const sections = planner.operations().map(formatOperation);
  if (!sections.length) sections.push("No file changes.");
  if (planner.notes.length) {
    sections.push(["Manual steps (not executed):", ...planner.notes.map((note) => `  ${note}`)].join("\n"));
  }
  return sections.join("\n\n");
}

function formatOperation(operation) {
  const { before, after, label } = operation;
  if (after.kind === "symlink") {
    const verb = before.kind === "missing" ? "CREATE" : "UPDATE";
    return `${verb} ${label} -> ${after.target}`;
  }
  if (after.kind === "missing") {
    if (before.kind === "symlink") return `DELETE ${label} -> ${before.target}`;
    return [`DELETE ${label}`, ...prefixLines(before.content, "-")].join("\n");
  }
  if (before.kind === "missing") {
    return [`CREATE ${label}`, ...prefixLines(after.content, "+")].join("\n");
  }
  return [`UPDATE ${label}`, ...compactDiff(before.content, after.content)].join("\n");
}

function compactDiff(before, after) {
  const left = before.split("\n");
  const right = after.split("\n");
  let prefix = 0;
  while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < left.length - prefix && suffix < right.length - prefix
    && left[left.length - 1 - suffix] === right[right.length - 1 - suffix]) suffix += 1;

  const output = [];
  if (prefix) output.push(` ${left[prefix - 1]}`);
  output.push(...left.slice(prefix, left.length - suffix).map((line) => `-${line}`));
  output.push(...right.slice(prefix, right.length - suffix).map((line) => `+${line}`));
  if (suffix) output.push(` ${left[left.length - suffix]}`);
  return output;
}

function prefixLines(content, prefix) {
  return content.split("\n").map((line) => `${prefix}${line}`);
}

function readState(file) {
  try {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) return { kind: "symlink", target: fs.readlinkSync(file) };
    if (stat.isFile()) return { kind: "file", content: fs.readFileSync(file, "utf8"), mode: stat.mode };
    if (stat.isDirectory()) return { kind: "directory" };
    return { kind: "other" };
  } catch (error) {
    if (error.code === "ENOENT") return { kind: "missing" };
    throw error;
  }
}

function sameState(left, right) {
  if (left.kind !== right.kind) return false;
  if (left.kind === "missing") return true;
  if (left.kind === "file") {
    return left.content === right.content && (left.mode & 0o777) === (right.mode & 0o777);
  }
  if (left.kind === "symlink") return left.target === right.target;
  return false;
}
