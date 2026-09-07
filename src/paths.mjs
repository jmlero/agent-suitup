import path from "node:path";

export function portablePath(file, { cwd, home }) {
  const absolute = path.resolve(file);
  const projectRelative = path.relative(cwd, absolute);
  if (projectRelative && !projectRelative.startsWith("..") && !path.isAbsolute(projectRelative)) {
    return `./${slash(projectRelative)}`;
  }
  if (absolute === cwd) return ".";

  const homeRelative = path.relative(home, absolute);
  if (homeRelative && !homeRelative.startsWith("..") && !path.isAbsolute(homeRelative)) {
    return `~/${slash(homeRelative)}`;
  }
  if (absolute === home) return "~";
  return slash(absolute);
}

export function resolvePortablePath(value, { cwd, home }) {
  if (value === ".") return cwd;
  if (value.startsWith("./")) return path.resolve(cwd, value.slice(2));
  if (value === "~") return home;
  if (value.startsWith("~/")) return path.resolve(home, value.slice(2));
  return path.resolve(value);
}

export function scopeRoot(scope, { cwd, home }) {
  return scope === "user" ? home : cwd;
}

function slash(value) {
  return value.split(path.sep).join("/");
}
