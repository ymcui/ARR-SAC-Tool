"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, useTransition } from "react";

import { AlertsPanel } from "@/components/alerts-panel";
import { ACDashboardPanel } from "@/components/ac-dashboard-panel";
import { CommentsPanel } from "@/components/comments-panel";
import { LoginPanel } from "@/components/login-panel";
import { PapersPanel } from "@/components/papers-panel";
import { Toolbar } from "@/components/toolbar";
import { VenueWorkspacePanel } from "@/components/venue-workspace-panel";
import type { DashboardLoadProgress, DashboardResponse, TabKey, VenueStage, ViewerInfo } from "@/lib/types";
import { GITHUB_REPOSITORY_URL, LOCAL_APP_VERSION } from "@/lib/version";

const AnalyticsPanel = dynamic(() => import("@/components/analytics-panel"), {
  ssr: false,
  loading: () => (
    <section className="panel">
      <div className="empty-state inset">
        <h3>Loading analytics...</h3>
        <p>The heavier chart layer is being loaded on demand.</p>
      </div>
    </section>
  )
});

const VIEWER_STORAGE_KEY = "arr-sac-dashboard.viewer";
const VENUE_STORAGE_KEY = "arr-sac-dashboard.venue";
const RECENT_VENUES_STORAGE_KEY = "arr-sac-dashboard.recent-venues";
const DEFAULT_VENUE_ID = "aclweb.org/ACL/ARR/2026/March";
const ARR_STAGE_PREFIX = "aclweb.org/ACL/ARR";
const MAX_RECENT_VENUES = 8;

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "papers", label: "Papers" },
  { key: "ac", label: "AC Dashboard" },
  { key: "alerts", label: "Alerts" },
  { key: "comments", label: "Comments" },
  { key: "analytics", label: "Analytics" }
];
const COMMITMENT_TABS = TABS.filter((tab) => tab.key !== "ac" && tab.key !== "alerts");

async function parseJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

function apiUrl(path: string): string {
  return path;
}

function getVenueStage(venueId: string): VenueStage {
  return venueId.trim().startsWith(ARR_STAGE_PREFIX) ? "ARR Stage" : "Commitment Stage";
}

function parseRecentVenueIds(rawValue: string | null): string[] {
  if (!rawValue) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  } catch {
    return [];
  }
}

function readRecentVenueIds(): string[] {
  try {
    if (typeof window.localStorage?.getItem !== "function") {
      return [];
    }
    return parseRecentVenueIds(window.localStorage.getItem(RECENT_VENUES_STORAGE_KEY));
  } catch {
    return [];
  }
}

function writeRecentVenueIds(recentVenueIds: string[]) {
  try {
    if (typeof window.localStorage?.setItem === "function") {
      window.localStorage.setItem(RECENT_VENUES_STORAGE_KEY, JSON.stringify(recentVenueIds));
    }
  } catch {
    // Ignore storage failures; the input still works normally without suggestions.
  }
}

function addRecentVenueId(venueId: string, recentVenueIds: string[]): string[] {
  const trimmedVenueId = venueId.trim();
  if (!trimmedVenueId) {
    return recentVenueIds;
  }

  const nextVenueIds = [
    trimmedVenueId,
    ...recentVenueIds.filter((item) => item !== trimmedVenueId && item.trim().length > 0)
  ].slice(0, MAX_RECENT_VENUES);
  writeRecentVenueIds(nextVenueIds);
  return nextVenueIds;
}

export function DashboardShell() {
  const [viewer, setViewer] = useState<ViewerInfo | null>(null);
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [venueId, setVenueId] = useState(DEFAULT_VENUE_ID);
  const [activeTab, setActiveTab] = useState<TabKey>("papers");
  const [authError, setAuthError] = useState<string | null>(null);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isLoadingDashboard, setIsLoadingDashboard] = useState(false);
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [loadProgress, setLoadProgress] = useState<DashboardLoadProgress | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [recentVenueIds, setRecentVenueIds] = useState<string[]>([]);
  const [, startTransition] = useTransition();
  const progressPollId = useRef<number | null>(null);

  useEffect(() => {
    const savedVenue = window.sessionStorage.getItem(VENUE_STORAGE_KEY);
    const savedViewer = window.sessionStorage.getItem(VIEWER_STORAGE_KEY);
    const savedRecentVenueIds = readRecentVenueIds();
    setRecentVenueIds(
      savedRecentVenueIds.length > 0 ? savedRecentVenueIds : [savedVenue || DEFAULT_VENUE_ID]
    );

    if (savedVenue) {
      setVenueId(savedVenue);
    }

    if (savedViewer) {
      try {
        const parsedViewer = JSON.parse(savedViewer) as ViewerInfo;
        setViewer(parsedViewer);
      } catch {
        window.sessionStorage.removeItem(VIEWER_STORAGE_KEY);
      }
    }
  }, []);

  useEffect(() => () => stopProgressPolling(), []);

  function stopProgressPolling() {
    if (progressPollId.current !== null) {
      window.clearInterval(progressPollId.current);
      progressPollId.current = null;
    }
  }

  async function fetchProgress(nextVenueId: string) {
    try {
      const response = await fetch(
        apiUrl(`/api/dashboard/progress?venueId=${encodeURIComponent(nextVenueId)}`),
        { credentials: "include" }
      );

      if (response.status === 401) {
        stopProgressPolling();
        return;
      }

      if (!response.ok) {
        return;
      }

      const payload = await parseJson<DashboardLoadProgress>(response);
      setLoadProgress(payload);

      if (payload.done || payload.error) {
        stopProgressPolling();
      }
    } catch {
      stopProgressPolling();
    }
  }

  function startProgressPolling(nextVenueId: string) {
    stopProgressPolling();
    setLoadProgress({
      venueId: nextVenueId,
      phase: "venue",
      message: "Starting venue load...",
      current: 0,
      total: 0,
      done: false,
      error: null
    });
    progressPollId.current = window.setInterval(() => {
      void fetchProgress(nextVenueId);
    }, 1000);
  }

  async function requestDashboard(nextVenueId: string, refresh: boolean) {
    const trimmedVenueId = nextVenueId.trim();
    if (!trimmedVenueId) {
      setDashboardError("Enter a venue ID before loading the workspace.");
      return;
    }

    setIsLoadingDashboard(true);
    setDashboardError(null);
    startProgressPolling(trimmedVenueId);

    try {
      const response = await fetch(
        apiUrl(`/api/dashboard?venueId=${encodeURIComponent(trimmedVenueId)}&refresh=${refresh ? "1" : "0"}`),
        { credentials: "include" }
      );

      if (response.status === 401) {
        clearClientSession();
        setAuthError("Your OpenReview session expired. Sign in again to continue.");
        setIsLoginOpen(true);
        return;
      }

      if (!response.ok) {
        const payload = await parseJson<{ detail?: string }>(response);
        throw new Error(payload.detail || "Could not load the selected venue.");
      }

      const payload = await parseJson<DashboardResponse>(response);
      startTransition(() => {
        setDashboard(payload);
        setViewer(payload.viewer);
        setVenueId(trimmedVenueId);
        setActiveTab((current) =>
          payload.venue.stage === "Commitment Stage" && (current === "ac" || current === "alerts")
            ? "papers"
            : current
        );
      });
      setLoadProgress({
        venueId: trimmedVenueId,
        phase: "ready",
        message: `Loaded ${payload.summary.totalPapers} papers for this SAC batch.`,
        current: payload.summary.totalPapers,
        total: payload.summary.totalPapers,
        done: true,
        error: null
      });
      window.sessionStorage.setItem(VENUE_STORAGE_KEY, trimmedVenueId);
      window.sessionStorage.setItem(VIEWER_STORAGE_KEY, JSON.stringify(payload.viewer));
      setRecentVenueIds((currentVenueIds) => addRecentVenueId(trimmedVenueId, currentVenueIds));
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : "Unexpected dashboard error.";
      setDashboardError(message);
      setLoadProgress({
        venueId: trimmedVenueId,
        phase: "error",
        message,
        current: 0,
        total: 0,
        done: true,
        error: message
      });
    } finally {
      stopProgressPolling();
      setIsLoadingDashboard(false);
    }
  }

  async function handleLogin(username: string, password: string) {
    if (!username || !password) {
      setAuthError("Enter both your OpenReview email and password.");
      return;
    }

    setIsAuthenticating(true);
    setAuthError(null);

    try {
      const response = await fetch(apiUrl("/api/session/login"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        credentials: "include",
        body: JSON.stringify({ username, password })
      });

      if (!response.ok) {
        const payload = await parseJson<{ detail?: string }>(response);
        throw new Error(payload.detail || "Login failed.");
      }

      const nextViewer = await parseJson<ViewerInfo>(response);
      startTransition(() => {
        setViewer(nextViewer);
      });
      window.sessionStorage.setItem(VIEWER_STORAGE_KEY, JSON.stringify(nextViewer));
      setIsLoginOpen(false);
    } catch (nextError) {
      setAuthError(nextError instanceof Error ? nextError.message : "Unexpected login error.");
    } finally {
      setIsAuthenticating(false);
    }
  }

  async function handleLogout() {
    await fetch(apiUrl("/api/session/logout"), {
      method: "POST",
      credentials: "include"
    }).catch(() => undefined);
    clearClientSession();
  }

  async function handleExport() {
    if (!dashboard) {
      setExportError("Load a venue before exporting.");
      return;
    }

    setIsExporting(true);
    setExportError(null);

    try {
      const response = await fetch(
        apiUrl(`/api/dashboard/export?venueId=${encodeURIComponent(dashboard.venue.venueId)}`),
        { credentials: "include" }
      );

      if (response.status === 401) {
        clearClientSession();
        setAuthError("Your OpenReview session expired. Sign in again to continue.");
        setIsLoginOpen(true);
        return;
      }

      if (!response.ok) {
        const payload = await parseJson<{ detail?: string }>(response);
        throw new Error(payload.detail || "Could not export the selected venue.");
      }

      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") || "";
      const filenameMatch = disposition.match(/filename="([^"]+)"/);
      const filename = filenameMatch?.[1] ?? "paper_export.xlsx";
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
    } catch (nextError) {
      setExportError(nextError instanceof Error ? nextError.message : "Unexpected export error.");
    } finally {
      setIsExporting(false);
    }
  }

  function clearClientSession() {
    window.sessionStorage.removeItem(VIEWER_STORAGE_KEY);
    setViewer(null);
    setDashboard(null);
    setLoadProgress(null);
    setAuthError(null);
    setDashboardError(null);
    setIsLoginOpen(false);
  }

  const isBusy = isAuthenticating || isLoadingDashboard;
  const hasDashboard = dashboard !== null;
  const visibleTabs = dashboard?.venue.stage === "Commitment Stage" ? COMMITMENT_TABS : TABS;
  const selectedTab = visibleTabs.some((tab) => tab.key === activeTab) ? activeTab : "papers";
  const venueStage = getVenueStage(venueId);

  return (
    <div className="shell">
      <div className="shell-inner">
        <header className="shell-header">
          <Toolbar
            activeTab={selectedTab}
            isBusy={isBusy}
            onLogin={() => {
              setAuthError(null);
              setIsLoginOpen(true);
            }}
            onLogout={() => void handleLogout()}
            onTabChange={setActiveTab}
            showTabs={viewer && dashboard ? true : false}
            tabs={visibleTabs}
            venueStage={venueStage}
            viewer={viewer}
          />
        </header>

        <main className="workspace">
          <section className="workspace-top-grid">
            <VenueWorkspacePanel
              isBusy={isBusy}
              lastSyncedAt={dashboard?.venue.lastSyncedAt}
              loadProgress={loadProgress}
              onLoad={() => void requestDashboard(venueId, false)}
              onRefresh={() => void requestDashboard(venueId, true)}
              onVenueIdChange={(value) => {
                setVenueId(value);
                window.sessionStorage.setItem(VENUE_STORAGE_KEY, value);
              }}
              recentVenueIds={recentVenueIds}
              venueId={venueId}
              viewer={viewer}
            />
          </section>

          {dashboardError ? <div className="error-banner">{dashboardError}</div> : null}

          {viewer && dashboard ? (
            <>
              <div className="panel-stack">
                {selectedTab === "papers" ? (
                  <PapersPanel
                    exportError={exportError}
                    isExporting={isExporting}
                    onExport={() => void handleExport()}
                    papers={dashboard.papers}
                    venueStage={dashboard.venue.stage}
                    withdrawnPapers={dashboard.withdrawnPapers ?? []}
                  />
                ) : null}
                {selectedTab === "ac" ? (
                  <ACDashboardPanel areaChairs={dashboard.areaChairs} papers={dashboard.papers} />
                ) : null}
                {selectedTab === "alerts" ? (
                  <AlertsPanel
                    alerts={dashboard.alerts}
                    areaChairs={dashboard.areaChairs}
                    papers={dashboard.papers}
                  />
                ) : null}
                {selectedTab === "comments" ? <CommentsPanel comments={dashboard.comments} /> : null}
                {selectedTab === "analytics" ? <AnalyticsPanel analytics={dashboard.analytics} /> : null}
              </div>
            </>
          ) : null}

        </main>

        <footer className="app-footer">
          <a
            aria-label="Open ymcui/ARR-SAC-Tool on GitHub"
            className="github-badge"
            href={GITHUB_REPOSITORY_URL}
            rel="noreferrer"
            target="_blank"
          >
            <svg aria-hidden="true" className="github-badge-icon" viewBox="0 0 24 24">
              <path
                d="M12 .5A11.5 11.5 0 0 0 8.36 22.9c.58.1.79-.25.79-.56v-2c-3.22.7-3.9-1.38-3.9-1.38-.53-1.35-1.3-1.7-1.3-1.7-1.06-.72.08-.7.08-.7 1.17.08 1.79 1.2 1.79 1.2 1.04 1.78 2.73 1.27 3.4.97.1-.75.41-1.27.74-1.56-2.57-.29-5.27-1.28-5.27-5.72 0-1.26.45-2.3 1.2-3.1-.12-.3-.52-1.48.11-3.07 0 0 .98-.31 3.18 1.18a10.96 10.96 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.64 1.59.24 2.77.12 3.07.75.8 1.2 1.84 1.2 3.1 0 4.45-2.71 5.42-5.29 5.71.42.36.8 1.08.8 2.18v3.24c0 .31.2.67.8.56A11.5 11.5 0 0 0 12 .5Z"
                fill="currentColor"
              />
            </svg>
            ymcui/ARR-SAC-Tool
          </a>
          <span className="footer-version">v{LOCAL_APP_VERSION}</span>
        </footer>

        <LoginPanel
          error={authError}
          isBusy={isAuthenticating}
          isOpen={isLoginOpen}
          onClose={() => {
            if (!isAuthenticating) {
              setAuthError(null);
              setIsLoginOpen(false);
            }
          }}
          onLogin={handleLogin}
        />
      </div>
    </div>
  );
}
