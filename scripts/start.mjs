import { spawn } from "node:child_process";

const root = process.cwd();
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const apiHost = process.env.ARR_SAC_API_HOST ?? "127.0.0.1";
const apiPort = process.env.ARR_SAC_API_PORT ?? "8001";
const webHost = process.env.ARR_SAC_WEB_HOST ?? "127.0.0.1";
const webPort = process.env.ARR_SAC_WEB_PORT ?? "8000";
const apiOrigin = process.env.ARR_SAC_API_ORIGIN ?? `http://${apiHost}:${apiPort}`;
const useSystemPython =
  process.env.ARR_SAC_USE_SYSTEM_PYTHON === "1" || Boolean(process.env.COLAB_RELEASE_TAG);
const apiPython = process.env.ARR_SAC_API_PYTHON ?? (useSystemPython ? "python3" : "./.venv/bin/python");

const commands = [
  {
    name: "api",
    command: apiPython,
    args: [
      "-m",
      "uvicorn",
      "app.main:app",
      "--app-dir",
      "apps/api",
      "--host",
      apiHost,
      "--port",
      apiPort
    ]
  },
  {
    name: "web",
    command: npmCommand,
    args: [
      "run",
      "start",
      "--workspace",
      "@arr-sac/web",
      "--",
      "--hostname",
      webHost,
      "--port",
      webPort
    ],
    env: {
      ...process.env,
      ARR_SAC_API_ORIGIN: apiOrigin
    }
  }
];

const children = new Map();
let shuttingDown = false;
let forcedKillTimer = null;
let exitCode = 0;

function writePrefixed(target, prefix, line) {
  target.write(`[${prefix}] ${line}\n`);
}

function pipeOutput(stream, target, prefix) {
  let buffer = "";
  stream.setEncoding("utf8");

  stream.on("data", (chunk) => {
    buffer += chunk;

    while (true) {
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) {
        break;
      }

      const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
      buffer = buffer.slice(newlineIndex + 1);
      writePrefixed(target, prefix, line);
    }
  });

  stream.on("end", () => {
    if (buffer) {
      writePrefixed(target, prefix, buffer.replace(/\r$/, ""));
      buffer = "";
    }
  });
}

function killChildProcess(child, signal) {
  if (!child || child.exitCode !== null || child.killed) {
    return;
  }

  try {
    if (process.platform === "win32") {
      child.kill(signal);
    } else {
      process.kill(-child.pid, signal);
    }
  } catch {
    // Best-effort shutdown.
  }
}

function finalizeIfDone() {
  if (children.size !== 0) {
    return;
  }

  if (forcedKillTimer) {
    clearTimeout(forcedKillTimer);
    forcedKillTimer = null;
  }

  process.exit(exitCode);
}

function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  if (!exitCode) {
    exitCode = signal === "SIGINT" ? 130 : 143;
  }

  for (const child of children.values()) {
    killChildProcess(child, signal);
  }

  forcedKillTimer = setTimeout(() => {
    for (const child of children.values()) {
      killChildProcess(child, "SIGKILL");
    }
  }, 2000);

  forcedKillTimer.unref();
}

function spawnCommand({ name, command, args, env = process.env }) {
  const child = spawn(command, args, {
    cwd: root,
    env,
    stdio: ["inherit", "pipe", "pipe"],
    detached: process.platform !== "win32"
  });

  children.set(name, child);

  pipeOutput(child.stdout, process.stdout, name);
  pipeOutput(child.stderr, process.stderr, name);

  child.on("error", (error) => {
    writePrefixed(process.stderr, name, `Process error: ${error.message}`);
    exitCode = exitCode || 1;
    shutdown("SIGTERM");
  });

  child.on("exit", (code, signal) => {
    children.delete(name);

    if (!shuttingDown) {
      exitCode = code ?? (signal ? 1 : 0);
      shutdown("SIGTERM");
    }

    finalizeIfDone();
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

for (const command of commands) {
  spawnCommand(command);
}
