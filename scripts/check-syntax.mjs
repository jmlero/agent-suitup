// Syntax-checks every module shipped in bin/ and src/, including modules no
// test imports.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = ["bin", "src"].flatMap((directory) => modules(path.join(root, directory)));
const failed = files.filter((file) => spawnSync(process.execPath, ["--check", file], { stdio: "inherit" }).status !== 0);
if (failed.length) {
  console.error(`Syntax check failed: ${failed.map((file) => path.relative(root, file)).join(", ")}`);
  process.exitCode = 1;
} else {
  console.log(`Syntax check passed for ${files.length} modules.`);
}

function modules(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return modules(file);
    return entry.name.endsWith(".mjs") ? [file] : [];
  });
}
