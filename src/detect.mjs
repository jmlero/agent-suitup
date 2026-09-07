import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

export function detectStack(cwd = process.cwd()) {
  const exists = (entry) => fs.existsSync(path.join(cwd, entry));
  const read = (entry) => exists(entry) ? fs.readFileSync(path.join(cwd, entry), "utf8") : "";
  const context = {
    cwd,
    isGitRepo: exists(".git"),
    hasDockerfile: ["Dockerfile", "docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"].some(exists),
    hasDocs: exists("docs") || exists("README.md") || exists("readme.md"),
    hasTsConfig: exists("tsconfig.json"),
    hasPackageJson: exists("package.json"),
    hasPyProject: exists("pyproject.toml"),
    hasRequirementsTxt: exists("requirements.txt"),
    hasGoMod: exists("go.mod"),
    hasCargoToml: exists("Cargo.toml"),
    hasCI: exists(".github/workflows") || exists(".gitlab-ci.yml") || exists(".circleci")
      || exists("azure-pipelines.yml") || exists("Jenkinsfile"),
  };

  try {
    context.hasTerraform = fs.readdirSync(cwd).some((name) => name.endsWith(".tf"))
      || exists("terraform") || exists("infra");
  } catch {
    context.hasTerraform = false;
  }

  context.hasPython = context.hasPyProject || context.hasRequirementsTxt;
  context.hasReact = false;
  context.hasVue = false;
  context.hasNextJs = false;
  context.hasSvelte = false;
  context.hasTypeScript = context.hasTsConfig;
  context.hasTypeScriptLanguageServer = commandAvailable("typescript-language-server");
  context.hasPyrightLanguageServer = commandAvailable("pyright-langserver");
  context.hasCodexCli = commandAvailable("codex");

  if (context.hasPackageJson) {
    try {
      const packageJson = JSON.parse(read("package.json"));
      const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
      context.hasReact = "react" in dependencies;
      context.hasVue = "vue" in dependencies;
      context.hasNextJs = "next" in dependencies;
      context.hasSvelte = "svelte" in dependencies || "@sveltejs/kit" in dependencies;
      context.hasTypeScript ||= "typescript" in dependencies;
    } catch {
      // A malformed package.json should not stop detection of other stacks.
    }
  }

  const pythonDependencies = `${read("pyproject.toml")}\n${read("requirements.txt")}`;
  context.hasFastAPI = /\bfastapi\b/i.test(pythonDependencies);

  try {
    const remote = execFileSync("git", ["remote", "get-url", "origin"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    context.isGitHubRepo = /github\.com/i.test(remote);
  } catch {
    context.isGitHubRepo = false;
  }

  return context;
}

export function humanSummary(context) {
  const labels = [
    ["hasReact", "React"],
    ["hasNextJs", "Next.js"],
    ["hasVue", "Vue"],
    ["hasSvelte", "Svelte"],
    ["hasTypeScript", "TypeScript"],
    ["hasPython", "Python"],
    ["hasFastAPI", "FastAPI"],
    ["hasGoMod", "Go"],
    ["hasCargoToml", "Rust"],
    ["hasTerraform", "Terraform"],
    ["hasDockerfile", "Docker"],
    ["hasCI", "CI"],
    ["isGitHubRepo", "GitHub"],
  ];
  return labels.filter(([signal]) => context[signal]).map(([, label]) => label);
}

export function commandAvailable(command, environment = process.env) {
  const directories = (environment.PATH ?? "").split(path.delimiter).filter(Boolean);
  const extensions = process.platform === "win32"
    ? (environment.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")
    : [""];
  return directories.some((directory) => extensions.some((extension) => {
    const candidate = path.join(directory, `${command}${extension}`);
    try {
      const stat = fs.statSync(candidate);
      return stat.isFile() && (process.platform === "win32" || (stat.mode & 0o111) !== 0);
    } catch {
      return false;
    }
  }));
}
