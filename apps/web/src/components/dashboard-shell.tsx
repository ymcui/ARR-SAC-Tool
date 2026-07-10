"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, useTransition } from "react";

import { AlertsPanel } from "@/components/alerts-panel";
import { ACDashboardPanel } from "@/components/ac-dashboard-panel";
import { CommentsPanel } from "@/components/comments-panel";
import { EmptyStateIcon } from "@/components/empty-state-icon";
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
        <EmptyStateIcon />
        <h3>Preparing analytics...</h3>
        <p>Charts will appear in a moment.</p>
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
const DASHBOARD_RECOVERY_TIMEOUT_MS = 120000;
const DASHBOARD_RECOVERY_POLL_MS = 1000;
const DASHBOARD_RECOVERY_PROBE_TIMEOUT_MS = 4000;
const DASHBOARD_REQUEST_TIMEOUT_MS = 125000;
const DASHBOARD_RECOVERY_GUIDANCE =
  "Try Load / Refresh again. If it fails again, refresh this page and sign in again if prompted. If the app is running locally, make sure npm run dev is still running.";
const DEFAULT_LOCAL_API_PORT = "8001";
const DEFAULT_LOCAL_WEB_PORT = "8000";
const BUILD_API_ORIGIN = process.env.NEXT_PUBLIC_ARR_SAC_API_ORIGIN?.replace(/\/$/, "");
const LOCAL_HOSTNAMES = new Set(["127.0.0.1", "localhost"]);

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

async function responseError(response: Response, fallback: string): Promise<Error> {
  try {
    const payload = (await response.clone().json()) as { detail?: unknown };
    if (typeof payload.detail === "string" && payload.detail.trim()) {
      return new Error(payload.detail);
    }
  } catch {
    // Some proxy and upstream failures return HTML or an empty body.
  }

  return new Error(fallback);
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("The dashboard request timed out while the API continued processing it.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function normalizeLocalApiOrigin(origin: string, browserHostname: string): string | null {
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }

    if (
      url.hostname === "0.0.0.0" ||
      (LOCAL_HOSTNAMES.has(url.hostname) && LOCAL_HOSTNAMES.has(browserHostname))
    ) {
      url.hostname = browserHostname;
    }

    return url.origin;
  } catch {
    return null;
  }
}

function localApiOrigin(configuredApiOrigin?: string): string | null {
  if (typeof window === "undefined" || !LOCAL_HOSTNAMES.has(window.location.hostname)) {
    return null;
  }

  if (configuredApiOrigin) {
    return normalizeLocalApiOrigin(configuredApiOrigin.replace(/\/$/, ""), window.location.hostname);
  }

  if (window.location.port === DEFAULT_LOCAL_WEB_PORT) {
    return `${window.location.protocol}//${window.location.hostname}:${DEFAULT_LOCAL_API_PORT}`;
  }

  return null;
}

function apiUrl(path: string, configuredApiOrigin?: string): string {
  const origin = localApiOrigin(configuredApiOrigin ?? BUILD_API_ORIGIN);
  return origin ? `${origin}${path}` : path;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function createLoadId(): string {
  if (typeof window.crypto?.randomUUID === "function") {
    return window.crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatDashboardErrorMessage(message: string): string {
  const trimmedMessage = message.trim();
  const normalizedMessage = trimmedMessage.toLowerCase();

  if (!trimmedMessage) {
    return `The dashboard could not be loaded. ${DASHBOARD_RECOVERY_GUIDANCE}`;
  }

  if (
    trimmedMessage === "The string did not match the expected pattern." ||
    normalizedMessage.includes("failed to fetch") ||
    normalizedMessage.includes("load failed") ||
    normalizedMessage.includes("networkerror") ||
    normalizedMessage.includes("could not reach the local api proxy")
  ) {
    return `The dashboard connection was interrupted before data could be loaded. ${DASHBOARD_RECOVERY_GUIDANCE}`;
  }

  if (normalizedMessage.includes("is still running")) {
    return `${trimmedMessage} If it keeps happening, refresh this page and sign in again if prompted.`;
  }

  return trimmedMessage;
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

export function DashboardShell({ configuredApiOrigin }: { configuredApiOrigin?: string } = {}) {
  const [viewer, setViewer] = useState<ViewerInfo | null>(null);
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [venueId, setVenueId] = useState(DEFAULT_VENUE_ID);
  const [activeTab, setActiveTab] = useState<TabKey>("papers");
  const [authError, setAuthError] = useState<string | null>(null);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
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

  async function fetchProgressSnapshot(nextVenueId: string): Promise<DashboardLoadProgress | null> {
    const response = await fetch(
      apiUrl(`/api/dashboard/progress?venueId=${encodeURIComponent(nextVenueId)}`, configuredApiOrigin),
      { credentials: "include" }
    );

    if (response.status === 401 || !response.ok) {
      return null;
    }

    return parseJson<DashboardLoadProgress>(response);
  }

  function isCurrentProgress(payload: DashboardLoadProgress, loadId: string): boolean {
    return payload.loadId === loadId;
  }

  async function fetchProgress(nextVenueId: string, loadId: string) {
    try {
      const payload = await fetchProgressSnapshot(nextVenueId);
      if (!payload || !isCurrentProgress(payload, loadId)) {
        return;
      }
      setLoadProgress(payload);

      if (payload.done || payload.error) {
        stopProgressPolling();
      }
    } catch {
      stopProgressPolling();
    }
  }

  function startProgressPolling(nextVenueId: string, loadId: string) {
    stopProgressPolling();
    setLoadProgress({
      venueId: nextVenueId,
      loadId,
      phase: "venue",
      message: "Starting venue load...",
      current: 0,
      total: 0,
      done: false,
      error: null
    });
    progressPollId.current = window.setInterval(() => {
      void fetchProgress(nextVenueId, loadId);
    }, 1000);
  }

  function applyDashboardPayload(
    payload: DashboardResponse,
    trimmedVenueId: string,
    progressMessage = `Loaded ${payload.summary.totalPapers} papers for this SAC batch.`
  ) {
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
      message: progressMessage,
      current: payload.summary.totalPapers,
      total: payload.summary.totalPapers,
      done: true,
      error: null
    });
    window.sessionStorage.setItem(VENUE_STORAGE_KEY, trimmedVenueId);
    window.sessionStorage.setItem(VIEWER_STORAGE_KEY, JSON.stringify(payload.viewer));
    setRecentVenueIds((currentVenueIds) => addRecentVenueId(trimmedVenueId, currentVenueIds));
  }

  async function requestCachedDashboard(trimmedVenueId: string, loadId?: string): Promise<DashboardResponse | null> {
    const loadIdQuery = loadId ? `&loadId=${encodeURIComponent(loadId)}` : "";
    const response = await fetch(
      apiUrl(
        `/api/dashboard?venueId=${encodeURIComponent(trimmedVenueId)}&refresh=0${loadIdQuery}`,
        configuredApiOrigin
      ),
      { credentials: "include" }
    );

    if (response.status === 401) {
      clearClientSession();
      setAuthError("Your OpenReview session expired. Sign in again to continue.");
      setIsLoginOpen(true);
      return null;
    }

    if (!response.ok) {
      throw await responseError(response, "Could not load the refreshed venue cache.");
    }

    return parseJson<DashboardResponse>(response);
  }

  async function recoverCompletedDashboardLoad(
    trimmedVenueId: string,
    loadId: string,
    refresh: boolean
  ): Promise<DashboardResponse | null> {
    const recoveryLabel = refresh ? "Refresh" : "Load";
    const probeDeadline = Date.now() + DASHBOARD_RECOVERY_PROBE_TIMEOUT_MS;
    let sawCurrentProgress = false;

    while (Date.now() < probeDeadline) {
      const progress = await fetchProgressSnapshot(trimmedVenueId);
      if (progress && isCurrentProgress(progress, loadId)) {
        sawCurrentProgress = true;
        setLoadProgress(progress);

        if (progress.error) {
          throw new Error(progress.error);
        }

        if (progress.done) {
          return requestCachedDashboard(trimmedVenueId, loadId);
        }

        break;
      }

      await sleep(DASHBOARD_RECOVERY_POLL_MS);
    }

    if (!sawCurrentProgress) {
      throw new Error(
        "The dashboard request could not reach the local API proxy. Make sure the dev server is still running, then try again."
      );
    }

    const deadline = Date.now() + DASHBOARD_RECOVERY_TIMEOUT_MS;
    setLoadProgress({
      venueId: trimmedVenueId,
      loadId,
      phase: "submissions",
      message: `${recoveryLabel} is still finishing. Waiting for the updated cache...`,
      current: 0,
      total: 0,
      done: false,
      error: null
    });

    while (Date.now() < deadline) {
      const progress = await fetchProgressSnapshot(trimmedVenueId);
      if (progress && isCurrentProgress(progress, loadId)) {
        setLoadProgress(progress);

        if (progress.error) {
          throw new Error(progress.error);
        }

        if (progress.done) {
          return requestCachedDashboard(trimmedVenueId, loadId);
        }
      }

      await sleep(DASHBOARD_RECOVERY_POLL_MS);
    }

    throw new Error(`${recoveryLabel} is still running. Try Load / Refresh again in a moment.`);
  }

  async function requestDashboard(nextVenueId: string, refresh: boolean) {
    const trimmedVenueId = nextVenueId.trim();
    if (!trimmedVenueId) {
      setDashboardError("Enter a venue ID before loading the workspace.");
      return;
    }

    setIsLoadingDashboard(true);
    setDashboardError(null);
    const loadId = createLoadId();
    startProgressPolling(trimmedVenueId, loadId);

    let shouldAttemptRecovery = true;

    try {
      const response = await fetchWithTimeout(
        apiUrl(
          `/api/dashboard?venueId=${encodeURIComponent(trimmedVenueId)}&refresh=${refresh ? "1" : "0"}&loadId=${encodeURIComponent(loadId)}`,
          configuredApiOrigin
        ),
        { credentials: "include" },
        DASHBOARD_REQUEST_TIMEOUT_MS
      );

      if (response.status === 401) {
        shouldAttemptRecovery = false;
        clearClientSession();
        setAuthError("Your OpenReview session expired. Sign in again to continue.");
        setIsLoginOpen(true);
        return;
      }

      if (!response.ok) {
        shouldAttemptRecovery = response.status >= 500 || response.status === 408 || response.status === 429;
        throw await responseError(response, "Could not load the selected venue.");
      }

      let payload: DashboardResponse;
      try {
        payload = await parseJson<DashboardResponse>(response);
      } catch {
        throw new Error("The dashboard API returned an invalid response.");
      }
      applyDashboardPayload(payload, trimmedVenueId);
    } catch (nextError) {
      let message = nextError instanceof Error ? nextError.message : "Unexpected dashboard error.";

      if (shouldAttemptRecovery) {
        stopProgressPolling();

        try {
          const recoveredPayload = await recoverCompletedDashboardLoad(trimmedVenueId, loadId, refresh);
          if (!recoveredPayload) {
            return;
          }

          applyDashboardPayload(
            recoveredPayload,
            trimmedVenueId,
            refresh
              ? "Loaded refreshed data after the local connection recovered."
              : "Loaded data after the local connection recovered."
          );
          return;
        } catch (recoveryError) {
          message = recoveryError instanceof Error ? recoveryError.message : message;
        }
      }

      const progressMessage = message.trim() || "Unexpected dashboard error.";
      const dashboardMessage = formatDashboardErrorMessage(message);
      setDashboardError(dashboardMessage);
      setLoadProgress({
        venueId: trimmedVenueId,
        phase: "error",
        message: progressMessage,
        current: 0,
        total: 0,
        done: true,
        error: progressMessage
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
      const response = await fetch(apiUrl("/api/session/login", configuredApiOrigin), {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        credentials: "include",
        body: JSON.stringify({ username, password })
      });

      if (!response.ok) {
        throw await responseError(response, "Login failed.");
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
    setIsLoggingOut(true);
    setDashboardError(null);
    try {
      const response = await fetch(apiUrl("/api/session/logout", configuredApiOrigin), {
        method: "POST",
        credentials: "include"
      });
      if (!response.ok) {
        throw await responseError(response, "Could not sign out. Your session is still active.");
      }
      clearClientSession();
    } catch (error) {
      setDashboardError(
        error instanceof Error ? error.message : "Could not sign out. Your session is still active."
      );
    } finally {
      setIsLoggingOut(false);
    }
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
        apiUrl(`/api/dashboard/export?venueId=${encodeURIComponent(dashboard.venue.venueId)}`, configuredApiOrigin),
        { credentials: "include" }
      );

      if (response.status === 401) {
        clearClientSession();
        setAuthError("Your OpenReview session expired. Sign in again to continue.");
        setIsLoginOpen(true);
        return;
      }

      if (!response.ok) {
        throw await responseError(response, "Could not export the selected venue.");
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

  const loadedDashboard =
    dashboard?.venue.venueId.trim() === venueId.trim() ? dashboard : null;
  const isBusy = isAuthenticating || isLoadingDashboard || isLoggingOut;
  const visibleTabs = loadedDashboard?.venue.stage === "Commitment Stage" ? COMMITMENT_TABS : TABS;
  const selectedTab = visibleTabs.some((tab) => tab.key === activeTab) ? activeTab : "papers";
  const venueStage = loadedDashboard?.venue.stage ?? getVenueStage(venueId);
  const shouldRefreshLoadedVenue = Boolean(
    dashboard?.venue.venueId && dashboard.venue.venueId.trim() === venueId.trim()
  );

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
            showTabs={viewer && loadedDashboard ? true : false}
            tabs={visibleTabs}
            venueStage={venueStage}
            viewer={viewer}
          />
        </header>

        <main className="workspace">
          <section className="workspace-top-grid">
            <VenueWorkspacePanel
              isBusy={isBusy}
              lastSyncedAt={loadedDashboard?.venue.lastSyncedAt}
              loadProgress={loadProgress}
              onLoadOrRefresh={() => void requestDashboard(venueId, shouldRefreshLoadedVenue)}
              onVenueIdChange={(value) => {
                setVenueId(value);
                if (value.trim() !== dashboard?.venue.venueId.trim()) {
                  setDashboardError(null);
                  setExportError(null);
                  setLoadProgress(null);
                  setActiveTab("papers");
                }
                window.sessionStorage.setItem(VENUE_STORAGE_KEY, value);
              }}
              recentVenueIds={recentVenueIds}
              stats={
                loadedDashboard
                  ? {
                      papers: loadedDashboard.summary.totalPapers,
                      areaChairs: loadedDashboard.areaChairs.length
                    }
                  : undefined
              }
              venueId={venueId}
              viewer={viewer}
            />
          </section>

          {dashboardError ? <div className="error-banner">{dashboardError}</div> : null}

          {viewer && loadedDashboard ? (
            <>
              <div className="panel-stack">
                {selectedTab === "papers" ? (
                  <PapersPanel
                    exportError={exportError}
                    isExporting={isExporting}
                    onExport={() => void handleExport()}
                    papers={loadedDashboard.papers}
                    venueStage={loadedDashboard.venue.stage}
                    withdrawnPapers={loadedDashboard.withdrawnPapers ?? []}
                  />
                ) : null}
                {selectedTab === "ac" ? (
                  <ACDashboardPanel areaChairs={loadedDashboard.areaChairs} papers={loadedDashboard.papers} />
                ) : null}
                {selectedTab === "alerts" ? (
                  <AlertsPanel
                    alerts={loadedDashboard.alerts}
                    areaChairs={loadedDashboard.areaChairs}
                    key={loadedDashboard.venue.venueId}
                    papers={loadedDashboard.papers}
                  />
                ) : null}
                {selectedTab === "comments" ? (
                  <CommentsPanel
                    comments={loadedDashboard.comments}
                    key={loadedDashboard.venue.venueId}
                    papers={loadedDashboard.papers}
                  />
                ) : null}
                {selectedTab === "analytics" ? (
                  <AnalyticsPanel analytics={loadedDashboard.analytics} papers={loadedDashboard.papers} />
                ) : null}
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
