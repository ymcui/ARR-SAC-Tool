import { join } from "node:path";

export function managedVenvPython(root = process.cwd()) {
  return process.platform === "win32"
    ? join(root, ".venv", "Scripts", "python.exe")
    : join(root, ".venv", "bin", "python");
}

export function systemPythonCommand() {
  return process.platform === "win32" ? "python" : "python3";
}

export function useSystemPython() {
  return process.env.ARR_SAC_USE_SYSTEM_PYTHON === "1" || Boolean(process.env.COLAB_RELEASE_TAG);
}

export function apiPythonCommand(root = process.cwd()) {
  return process.env.ARR_SAC_API_PYTHON ??
    (useSystemPython() ? systemPythonCommand() : managedVenvPython(root));
}
