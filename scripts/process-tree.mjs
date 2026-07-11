import { spawnSync } from "node:child_process";

export function terminateProcessTree(
  tree,
  signal,
  {
    platform = process.platform,
    killProcess = process.kill,
    spawnTaskkill = spawnSync
  } = {}
) {
  const child = tree?.child ?? tree;
  const pid = tree?.pid ?? child?.pid;
  if (!Number.isInteger(pid)) {
    return false;
  }

  if (platform === "win32") {
    // Node can only terminate the immediate child on Windows. taskkill /T
    // reaches reloaders and npm-launched grandchildren; /F keeps the parent
    // from exiting first and leaving those descendants orphaned.
    let result;
    try {
      result = spawnTaskkill("taskkill.exe", ["/pid", String(pid), "/t", "/f"], {
        stdio: "ignore",
        windowsHide: true
      });
    } catch (error) {
      result = { error, status: null };
    }

    if (!result?.error && result?.status === 0) {
      return true;
    }

    // Keep the leader alive after the first failed taskkill so the forced pass
    // can retry the whole tree. Fall back to the direct child only as a last
    // resort during that forced pass.
    if (signal === "SIGKILL" && child?.exitCode === null && child?.signalCode === null) {
      try {
        child.kill("SIGKILL");
      } catch {
        // Best-effort fallback after taskkill failed.
      }
    }
    return false;
  }

  try {
    // Use the saved process-group id even if its original leader has exited.
    // Descendants can keep a POSIX process group alive after that point.
    killProcess(-pid, signal);
    return true;
  } catch {
    return false;
  }
}
