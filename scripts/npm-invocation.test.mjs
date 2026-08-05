import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { createNpmInvocation } from "./npm-invocation.mjs";

test("keeps direct npm execution on POSIX platforms", () => {
  const args = ["run", "dev", "--workspace", "@arr-sac/web"];

  assert.deepEqual(createNpmInvocation(args, { platform: "linux" }), {
    command: "npm",
    args
  });
});

test("launches the npm JavaScript entry point through Node on Windows", () => {
  const args = ["run", "dev", "--", "--hostname", "host & whoami"];
  const invocation = createNpmInvocation(args, {
    platform: "win32",
    env: {
      npm_execpath: "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js"
    },
    nodeExecutable: "C:\\Program Files\\nodejs\\node.exe"
  });

  assert.deepEqual(invocation, {
    command: "C:\\Program Files\\nodejs\\node.exe",
    args: [
      "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js",
      ...args
    ]
  });
  assert.equal("shell" in invocation, false);
});

test("reports how to recover when a Windows script bypasses npm", () => {
  assert.throws(
    () => createNpmInvocation([], { platform: "win32", env: {} }),
    /Start this command through npm/
  );
});

test(
  "runs the installed npm CLI directly through Node",
  { skip: !process.env.npm_execpath },
  () => {
    const invocation = createNpmInvocation(["--version"], { platform: "win32" });
    const result = spawnSync(invocation.command, invocation.args, {
      encoding: "utf8",
      env: process.env,
      windowsHide: true
    });

    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+/);
  }
);
