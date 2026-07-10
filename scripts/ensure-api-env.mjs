import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import {
  apiPythonCommand,
  managedVenvPython,
  systemPythonCommand,
  useSystemPython
} from "./python-command.mjs";

const root = process.cwd();
const venvPython = managedVenvPython(root);
const requirementsPath = join(root, "apps", "api", "requirements.txt");
const stampPath = join(root, ".venv", ".requirements-stamp");
const systemStampPath = join(root, ".api-requirements-stamp");
const hasExplicitPython = Boolean(process.env.ARR_SAC_API_PYTHON);
const usesSystemPython = useSystemPython();
const usesManagedVenv = !hasExplicitPython && !usesSystemPython;
const backendPython = apiPythonCommand(root);

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit"
  });

  if (result.error) {
    console.error(`Could not run ${command}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function hashFile(path) {
  const hash = createHash("sha256");
  hash.update(readFileSync(path));
  return hash.digest("hex");
}

function requirementsSatisfied(pythonCommand) {
  const validationScript = String.raw`
import sys
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path

try:
    from packaging.requirements import Requirement
except ImportError:
    raise SystemExit(1)

for raw_line in Path(sys.argv[1]).read_text(encoding="utf-8").splitlines():
    line = raw_line.split("#", 1)[0].strip()
    if not line:
        continue
    requirement = Requirement(line)
    if requirement.marker and not requirement.marker.evaluate():
        continue
    try:
        installed = version(requirement.name)
    except PackageNotFoundError:
        raise SystemExit(1)
    if requirement.specifier and installed not in requirement.specifier:
        raise SystemExit(1)
`;
  const result = spawnSync(pythonCommand, ["-c", validationScript, requirementsPath], {
    cwd: root,
    stdio: "ignore"
  });
  return !result.error && result.status === 0;
}

if (usesManagedVenv && !existsSync(venvPython)) {
  run(systemPythonCommand(), ["-m", "venv", ".venv"]);
}

const desiredStamp = hashFile(requirementsPath);
const activeStampPath = usesManagedVenv ? stampPath : systemStampPath;
const currentStamp = existsSync(activeStampPath) ? readFileSync(activeStampPath, "utf8").trim() : "";

if (currentStamp !== desiredStamp || !requirementsSatisfied(backendPython)) {
  run(backendPython, ["-m", "pip", "install", "-r", requirementsPath]);
  if (!requirementsSatisfied(backendPython)) {
    console.error("The Python environment still does not satisfy apps/api/requirements.txt after installation.");
    process.exit(1);
  }
  writeFileSync(activeStampPath, `${desiredStamp}\n`);
}
