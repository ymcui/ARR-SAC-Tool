import assert from "node:assert/strict";
import test from "node:test";

import { terminateProcessTree } from "./process-tree.mjs";

test("uses the saved POSIX process-group id after its leader exits", () => {
  const calls = [];
  const tree = {
    child: {
      pid: 111,
      exitCode: 0,
      signalCode: "SIGTERM"
    },
    pid: 222
  };

  const terminated = terminateProcessTree(tree, "SIGKILL", {
    platform: "linux",
    killProcess: (pid, signal) => calls.push([pid, signal])
  });

  assert.equal(terminated, true);
  assert.deepEqual(calls, [[-222, "SIGKILL"]]);
});

test("uses taskkill to terminate the complete Windows process tree", () => {
  const taskkillCalls = [];
  let directKills = 0;
  const tree = {
    child: {
      pid: 333,
      exitCode: null,
      signalCode: null,
      kill: () => {
        directKills += 1;
      }
    },
    pid: 333
  };

  const terminated = terminateProcessTree(tree, "SIGTERM", {
    platform: "win32",
    spawnTaskkill: (command, args, options) => {
      taskkillCalls.push([command, args, options]);
      return { status: 0 };
    }
  });

  assert.equal(terminated, true);
  assert.equal(directKills, 0);
  assert.deepEqual(taskkillCalls, [
    [
      "taskkill.exe",
      ["/pid", "333", "/t", "/f"],
      { stdio: "ignore", windowsHide: true }
    ]
  ]);
});

test("defers the direct Windows fallback until the forced pass", () => {
  const directKillSignals = [];
  const tree = {
    child: {
      pid: 444,
      exitCode: null,
      signalCode: null,
      kill: (signal) => directKillSignals.push(signal)
    },
    pid: 444
  };
  const failedTaskkill = () => ({ status: 1 });

  assert.equal(
    terminateProcessTree(tree, "SIGTERM", {
      platform: "win32",
      spawnTaskkill: failedTaskkill
    }),
    false
  );
  assert.deepEqual(directKillSignals, []);

  assert.equal(
    terminateProcessTree(tree, "SIGKILL", {
      platform: "win32",
      spawnTaskkill: failedTaskkill
    }),
    false
  );
  assert.deepEqual(directKillSignals, ["SIGKILL"]);
});
