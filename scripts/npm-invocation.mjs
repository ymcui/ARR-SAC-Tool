export function createNpmInvocation(
  args,
  {
    platform = process.platform,
    env = process.env,
    nodeExecutable = process.execPath
  } = {}
) {
  if (platform !== "win32") {
    return {
      command: "npm",
      args: [...args]
    };
  }

  const npmCli = env.npm_execpath;
  if (!npmCli) {
    throw new Error(
      "Could not locate npm's CLI entry point. Start this command through npm, for example with `npm run dev`."
    );
  }

  return {
    command: nodeExecutable,
    args: [npmCli, ...args]
  };
}
