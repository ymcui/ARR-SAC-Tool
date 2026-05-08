import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const venvPython = join(root, ".venv", "bin", "python");
const requirementsPath = join(root, "apps", "api", "requirements.txt");
const stampPath = join(root, ".venv", ".requirements-stamp");

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit"
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function hashFile(path) {
  const hash = createHash("sha256");
  hash.update(readFileSync(path));
  return hash.digest("hex");
}

function hasBackendModules() {
  if (!existsSync(venvPython)) {
    return false;
  }

  const result = spawnSync(
    venvPython,
    ["-c", "import fastapi, uvicorn, openreview, pytest"],
    {
      cwd: root,
      stdio: "ignore"
    }
  );

  return result.status === 0;
}

if (!existsSync(venvPython)) {
  run("python3", ["-m", "venv", ".venv"]);
}

const desiredStamp = hashFile(requirementsPath);
const currentStamp = existsSync(stampPath) ? readFileSync(stampPath, "utf8").trim() : "";
const modulesReady = hasBackendModules();

if (modulesReady && !currentStamp) {
  writeFileSync(stampPath, `${desiredStamp}\n`);
  process.exit(0);
}

if (!modulesReady || currentStamp !== desiredStamp) {
  run(venvPython, ["-m", "pip", "install", "-r", requirementsPath]);
  writeFileSync(stampPath, `${desiredStamp}\n`);
}
