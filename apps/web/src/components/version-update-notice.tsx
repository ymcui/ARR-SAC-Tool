"use client";

import { useEffect, useState } from "react";

import {
  GITHUB_CHANGELOG_URL,
  GITHUB_PACKAGE_URL,
  LOCAL_APP_VERSION,
  isVersionBehind
} from "@/lib/version";

type PackageVersionResponse = {
  version?: unknown;
};

export function VersionUpdateNotice() {
  const [latestVersion, setLatestVersion] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function checkVersion() {
      try {
        const response = await fetch(GITHUB_PACKAGE_URL, {
          cache: "no-store",
          credentials: "omit"
        });

        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as PackageVersionResponse;
        if (typeof payload.version !== "string") {
          return;
        }

        if (isMounted && isVersionBehind(LOCAL_APP_VERSION, payload.version)) {
          setLatestVersion(payload.version);
        }
      } catch {
        // Version checks should never interrupt the dashboard.
      }
    }

    void checkVersion();

    return () => {
      isMounted = false;
    };
  }, []);

  if (!latestVersion) {
    return null;
  }

  return (
    <a
      aria-label={`Update available: local version v${LOCAL_APP_VERSION}, latest version v${latestVersion}`}
      className="status-chip update-available"
      href={GITHUB_CHANGELOG_URL}
      rel="noreferrer"
      target="_blank"
      title={`Local v${LOCAL_APP_VERSION}; latest v${latestVersion}`}
    >
      <svg aria-hidden="true" className="update-icon" viewBox="0 0 24 24">
        <path d="M12 5v11" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
        <path d="m7 10 5-5 5 5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
        <path d="M5 19h14" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
      </svg>
      Update available: v{latestVersion}
    </a>
  );
}
