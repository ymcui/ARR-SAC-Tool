import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const venvPython = join(root, ".venv", "bin", "python");
const requirementsPath = join(root, "apps", "api", "requirements.txt");
const stampPath = join(root, ".venv", ".requirements-stamp");
const systemStampPath = join(root, ".api-requirements-stamp");
const useSystemPython =
  process.env.ARR_SAC_USE_SYSTEM_PYTHON === "1" || Boolean(process.env.COLAB_RELEASE_TAG);
const backendPython = process.env.ARR_SAC_API_PYTHON ?? (useSystemPython ? "python3" : venvPython);

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

function hasBackendModules(pythonCommand) {
  if (!useSystemPython && !existsSync(pythonCommand)) {
    return false;
  }

  const result = spawnSync(
    pythonCommand,
    ["-c", "import fastapi, uvicorn, openreview, pytest"],
    {
      cwd: root,
      stdio: "ignore"
    }
  );

  return result.status === 0;
}

if (!useSystemPython && !existsSync(venvPython)) {
  run("python3", ["-m", "venv", ".venv"]);
}

const desiredStamp = hashFile(requirementsPath);
const activeStampPath = useSystemPython ? systemStampPath : stampPath;
const currentStamp = existsSync(activeStampPath) ? readFileSync(activeStampPath, "utf8").trim() : "";
const modulesReady = hasBackendModules(backendPython);

if (modulesReady && !currentStamp) {
  writeFileSync(activeStampPath, `${desiredStamp}\n`);
  process.exit(0);
}

if (!modulesReady || currentStamp !== desiredStamp) {
  run(backendPython, ["-m", "pip", "install", "-r", requirementsPath]);
  writeFileSync(activeStampPath, `${desiredStamp}\n`);
}
