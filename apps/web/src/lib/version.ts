import packageInfo from "../../../../package.json";

export const LOCAL_APP_VERSION = packageInfo.version;
export const GITHUB_PACKAGE_URL = "https://raw.githubusercontent.com/ymcui/ARR-SAC-Tool/main/package.json";
export const GITHUB_REPOSITORY_URL = "https://github.com/ymcui/ARR-SAC-Tool";

type ParsedVersion = {
  major: number;
  minor: number;
  patch: number;
};

function parseVersion(version: string): ParsedVersion | null {
  const match = version.trim().match(/^(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) {
    return null;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3] ?? 0)
  };
}

export function isVersionBehind(localVersion: string, remoteVersion: string): boolean {
  const local = parseVersion(localVersion);
  const remote = parseVersion(remoteVersion);

  if (!local || !remote) {
    return false;
  }

  if (remote.major !== local.major) {
    return remote.major > local.major;
  }

  if (remote.minor !== local.minor) {
    return remote.minor > local.minor;
  }

  return remote.patch > local.patch;
}
