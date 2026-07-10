import { spawn } from "node:child_process";

import { apiPythonCommand } from "./python-command.mjs";

const child = spawn(apiPythonCommand(), process.argv.slice(2), {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit"
});

child.on("error", (error) => {
  console.error(`Could not start Python: ${error.message}`);
  process.exitCode = 1;
});

child.on("close", (code, signal) => {
  process.exitCode = process.exitCode || code || (signal ? 1 : 0);
});
