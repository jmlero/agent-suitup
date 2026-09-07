import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { detectStack, humanSummary } from "../src/detect.mjs";

test("detects JavaScript, Python, Terraform, Docker, and documentation signals", (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-suitup-detect-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({
    dependencies: { react: "1", next: "1", typescript: "1" },
  }));
  fs.writeFileSync(path.join(root, "pyproject.toml"), "dependencies = ['fastapi']\n");
  fs.writeFileSync(path.join(root, "main.tf"), "terraform {}\n");
  fs.writeFileSync(path.join(root, "Dockerfile"), "FROM scratch\n");
  fs.writeFileSync(path.join(root, "README.md"), "# Test\n");
  fs.mkdirSync(path.join(root, ".github", "workflows"), { recursive: true });

  const detected = detectStack(root);
  assert.equal(detected.hasReact, true);
  assert.equal(detected.hasNextJs, true);
  assert.equal(detected.hasTypeScript, true);
  assert.equal(detected.hasPython, true);
  assert.equal(detected.hasFastAPI, true);
  assert.equal(detected.hasTerraform, true);
  assert.equal(detected.hasDockerfile, true);
  assert.equal(detected.hasDocs, true);
  assert.equal(detected.hasCI, true);
  assert.deepEqual(humanSummary(detected).slice(0, 3), ["React", "Next.js", "TypeScript"]);
});
