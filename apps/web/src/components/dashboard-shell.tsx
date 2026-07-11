"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, useTransition } from "react";

import { AlertsPanel } from "@/components/alerts-panel";
import { ACDashboardPanel } from "@/components/ac-dashboard-panel";
import { CommentsPanel } from "@/components/comments-panel";
import { EmptyStateIcon } from "@/components/empty-state-icon";
import { LoginPanel } from "@/components/login-panel";
import { LoadProgressPanel } from "@/components/load-progress-panel";
import { PapersPanel } from "@/components/papers-panel";
import { Toolbar } from "@/components/toolbar";
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
const DEFAULT_VENUE_ID = "aclweb.org/ACL/ARR/2026/May";
const ARR_STAGE_PREFIX = "aclweb.org/ACL/ARR";
const MAX_RECENT_VENUES = 8;
const DASHBOARD_RECOVERY_TIMEOUT_MS = 120000;
const DASHBOARD_RECOVERY_POLL_MS = 1000;
const DASHBOARD_RECOVERY_PROBE_TIMEOUT_MS = 4000;
const DASHBOARD_REQUEST_TIMEOUT_MS = 125000;
const CACHED_DASHBOARD_REQUEST_TIMEOUT_MS = 15000;
const RESPONSE_BODY_TIMEOUT_MS = 15000;
const LOGIN_REQUEST_TIMEOUT_MS = 195000;
const SESSION_REQUEST_TIMEOUT_MS = 30000;
const EXPORT_REQUEST_TIMEOUT_MS = 60000;
const DASHBOARD_RECOVERY_GUIDANCE =
  "Try Load / Refresh again. If it fails again, refresh this page and sign in again if prompted. If the app is running locally, make sure npm run dev is still running.";
const DEFAULT_LOCAL_API_PORT = "8001";
const DEFAULT_LOCAL_WEB_PORT = "8000";
const BUILD_API_ORIGIN = process.env.NEXT_PUBLIC_ARR_SAC_API_ORIGIN?.replace(/\/$/, "");
const LOCAL_HOSTNAMES = new Set(["127.0.0.1", "localhost"]);

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "papers", label: "Papers" },
  { key: "ac", label: "Area Chairs" },
  { key: "alerts", label: "Alerts" },
  { key: "comments", label: "Comments" },
  { key: "analytics", label: "Analytics" }
];
const COMMITMENT_TABS = TABS.filter((tab) => tab.key !== "ac" && tab.key !== "alerts");

async function settleWithTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
  onTimeout?: () => void
): Promise<T> {
  let timeoutId: number | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = window.setTimeout(() => {
      onTimeout?.();
      reject(new Error(timeoutMessage));
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
    }
  }
}

type TimedResponse = {
  response: Response;
  controller: AbortController;
  deadline: number;
  timeoutMessage: string;
  didTimeOut: () => boolean;
  finish: () => void;
};

async function consumeTimedResponse<T>(
  timedResponse: TimedResponse,
  operation: (response: Response) => Promise<T>,
  maximumTimeoutMs: number,
  timeoutMessage: string
): Promise<T> {
  const remainingMs = timedResponse.deadline - Date.now();
  if (remainingMs <= 0) {
    timedResponse.controller.abort();
    timedResponse.finish();
    throw new Error(timedResponse.timeoutMessage);
  }

  try {
    return await settleWithTimeout(
      operation(timedResponse.response),
      Math.min(maximumTimeoutMs, remainingMs),
      timeoutMessage,
      () => timedResponse.controller.abort()
    );
  } catch (error) {
    if (timedResponse.didTimeOut()) {
      throw new Error(timedResponse.timeoutMessage);
    }
    throw error;
  } finally {
    timedResponse.finish();
  }
}

function discardTimedResponse(timedResponse: TimedResponse) {
  timedResponse.controller.abort();
  timedResponse.finish();
}

async function parseJson<T>(
  timedResponse: TimedResponse,
  timeoutMs = RESPONSE_BODY_TIMEOUT_MS,
  timeoutMessage = "The server response did not finish in time."
): Promise<T> {
  return (await consumeTimedResponse(
    timedResponse,
    (response) => response.json(),
    timeoutMs,
    timeoutMessage
  )) as T;
}

async function responseError(timedResponse: TimedResponse, fallback: string): Promise<Error> {
  try {
    const payload = (await consumeTimedResponse(
      timedResponse,
      (response) => response.json(),
      DASHBOARD_RECOVERY_PROBE_TIMEOUT_MS,
      "The error response did not finish in time."
    )) as { detail?: unknown };
    if (typeof payload.detail === "string" && payload.detail.trim()) {
      return new Error(payload.detail);
    }
  } catch {
    // Some proxy and upstream failures return HTML or an empty body.
  }

  return new Error(fallback);
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
  timeoutMessage = "The dashboard request timed out while the API continued processing it.",
  requestController = new AbortController()
): Promise<TimedResponse> {
  let didTimeOut = false;
  const deadline = Date.now() + timeoutMs;
  const timeoutId = window.setTimeout(() => {
    didTimeOut = true;
    requestController.abort();
  }, timeoutMs);
  try {
    const response = await fetch(input, { ...init, signal: requestController.signal });
    return {
      response,
      controller: requestController,
      deadline,
      timeoutMessage,
      didTimeOut: () => didTimeOut,
      finish: () => window.clearTimeout(timeoutId)
    };
  } catch (error) {
    window.clearTimeout(timeoutId);
    if (didTimeOut) {
      throw new Error(timeoutMessage);
    }
    throw error;
  }
}

class SessionExpiredError extends Error {
  constructor() {
    super("Your OpenReview session expired. Sign in again to continue.");
    this.name = "SessionExpiredError";
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

function remainingRequestTimeout(deadline: number, maximumTimeout: number): number {
  return Math.max(1, Math.min(maximumTimeout, deadline - Date.now()));
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
  const [hasRestoredSession, setHasRestoredSession] = useState(false);
  const [loadProgress, setLoadProgress] = useState<DashboardLoadProgress | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [recentVenueIds, setRecentVenueIds] = useState<string[]>([]);
  const [, startTransition] = useTransition();
  const progressPollId = useRef<number | null>(null);
  const progressPollRequest = useRef<AbortController | null>(null);
  const dashboardRequest = useRef<AbortController | null>(null);
  const activeLoadId = useRef<string | null>(null);

  useEffect(() => {
    try {
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
        const parsedViewer = JSON.parse(savedViewer) as ViewerInfo;
        setViewer(parsedViewer);
      }
    } catch {
      try {
        window.sessionStorage.removeItem(VIEWER_STORAGE_KEY);
      } catch {
        // Storage may be unavailable; continue with a fresh client session.
      }
    } finally {
      setHasRestoredSession(true);
    }
  }, []);

  useEffect(
    () => () => {
      stopProgressPolling(true);
      dashboardRequest.current?.abort();
      dashboardRequest.current = null;
    },
    []
  );

  function stopProgressPolling(invalidateLoad = false) {
    if (progressPollId.current !== null) {
      window.clearInterval(progressPollId.current);
      progressPollId.current = null;
    }
    progressPollRequest.current?.abort();
    progressPollRequest.current = null;
    if (invalidateLoad) {
      activeLoadId.current = null;
    }
  }

  async function fetchProgressSnapshot(
    nextVenueId: string,
    timeoutMs = DASHBOARD_RECOVERY_PROBE_TIMEOUT_MS,
    requestController?: AbortController
  ): Promise<DashboardLoadProgress | null> {
    const timedResponse = await fetchWithTimeout(
      apiUrl(`/api/dashboard/progress?venueId=${encodeURIComponent(nextVenueId)}`, configuredApiOrigin),
      { credentials: "include" },
      timeoutMs,
      "The dashboard progress request timed out.",
      requestController
    );
    const { response } = timedResponse;

    if (response.status === 401) {
      discardTimedResponse(timedResponse);
      throw new SessionExpiredError();
    }

    if (!response.ok) {
      discardTimedResponse(timedResponse);
      return null;
    }

    return parseJson<DashboardLoadProgress>(
      timedResponse,
      timeoutMs,
      "The dashboard progress response did not finish in time."
    );
  }

  function isCurrentProgress(payload: DashboardLoadProgress, loadId: string): boolean {
    return payload.loadId === loadId;
  }

  async function fetchProgress(nextVenueId: string, loadId: string) {
    if (activeLoadId.current !== loadId || progressPollRequest.current) {
      return;
    }

    const requestController = new AbortController();
    progressPollRequest.current = requestController;
    try {
      const payload = await fetchProgressSnapshot(
        nextVenueId,
        DASHBOARD_RECOVERY_PROBE_TIMEOUT_MS,
        requestController
      );
      if (
        activeLoadId.current !== loadId ||
        !payload ||
        !isCurrentProgress(payload, loadId)
      ) {
        return;
      }
      setLoadProgress(payload);

      if (payload.done || payload.error) {
        stopProgressPolling();
      }
    } catch (error) {
      if (error instanceof SessionExpiredError && activeLoadId.current === loadId) {
        handleSessionExpired(loadId);
      } else if (activeLoadId.current === loadId) {
        stopProgressPolling();
      }
    } finally {
      if (progressPollRequest.current === requestController) {
        progressPollRequest.current = null;
      }
    }
  }

  function startProgressPolling(nextVenueId: string, loadId: string) {
    stopProgressPolling(true);
    activeLoadId.current = loadId;
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
    }, DASHBOARD_RECOVERY_POLL_MS);
  }

  function applyDashboardPayload(
    payload: DashboardResponse,
    trimmedVenueId: string,
    loadId: string,
    progressMessage = `Loaded ${payload.summary.totalPapers} papers for this SAC batch.`
  ) {
    if (activeLoadId.current !== loadId) {
      return;
    }
    stopProgressPolling(true);
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

  async function requestCachedDashboard(
    trimmedVenueId: string,
    loadId?: string,
    timeoutMs = CACHED_DASHBOARD_REQUEST_TIMEOUT_MS
  ): Promise<DashboardResponse | null> {
    const loadIdQuery = loadId ? `&loadId=${encodeURIComponent(loadId)}` : "";
    const timedResponse = await fetchWithTimeout(
      apiUrl(
        `/api/dashboard?venueId=${encodeURIComponent(trimmedVenueId)}&refresh=0${loadIdQuery}`,
        configuredApiOrigin
      ),
      { credentials: "include" },
      timeoutMs,
      "The refreshed venue cache did not respond in time."
    );
    const { response } = timedResponse;

    if (response.status === 401) {
      discardTimedResponse(timedResponse);
      handleSessionExpired(loadId);
      return null;
    }

    if (!response.ok) {
      throw await responseError(timedResponse, "Could not load the refreshed venue cache.");
    }

    return parseJson<DashboardResponse>(
      timedResponse,
      timeoutMs,
      "The refreshed venue cache response did not finish in time."
    );
  }

  async function recoverCompletedDashboardLoad(
    trimmedVenueId: string,
    loadId: string,
    refresh: boolean
  ): Promise<DashboardResponse | null> {
    const recoveryLabel = refresh ? "Refresh" : "Load";
    const probeDeadline = Date.now() + DASHBOARD_RECOVERY_PROBE_TIMEOUT_MS;
    let sawCurrentProgress = false;

    while (activeLoadId.current === loadId && Date.now() < probeDeadline) {
      const progress = await fetchProgressSnapshot(
        trimmedVenueId,
        remainingRequestTimeout(probeDeadline, DASHBOARD_RECOVERY_PROBE_TIMEOUT_MS)
      );
      if (activeLoadId.current !== loadId) {
        return null;
      }
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

      const remainingProbeTime = probeDeadline - Date.now();
      if (remainingProbeTime > 0) {
        await sleep(Math.min(DASHBOARD_RECOVERY_POLL_MS, remainingProbeTime));
      }
    }

    if (activeLoadId.current !== loadId) {
      return null;
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

    while (activeLoadId.current === loadId && Date.now() < deadline) {
      const progress = await fetchProgressSnapshot(
        trimmedVenueId,
        remainingRequestTimeout(deadline, DASHBOARD_RECOVERY_PROBE_TIMEOUT_MS)
      );
      if (activeLoadId.current !== loadId) {
        return null;
      }
      if (progress && isCurrentProgress(progress, loadId)) {
        setLoadProgress(progress);

        if (progress.error) {
          throw new Error(progress.error);
        }

        if (progress.done) {
          return requestCachedDashboard(
            trimmedVenueId,
            loadId,
            remainingRequestTimeout(deadline, CACHED_DASHBOARD_REQUEST_TIMEOUT_MS)
          );
        }
      }

      const remainingRecoveryTime = deadline - Date.now();
      if (remainingRecoveryTime > 0) {
        await sleep(Math.min(DASHBOARD_RECOVERY_POLL_MS, remainingRecoveryTime));
      }
    }

    if (activeLoadId.current !== loadId) {
      return null;
    }

    throw new Error(`${recoveryLabel} is still running. Try Load / Refresh again in a moment.`);
  }

  async function requestDashboard(nextVenueId: string, refresh: boolean) {
    const trimmedVenueId = nextVenueId.trim();
    if (!trimmedVenueId) {
      setDashboardError("Enter a venue ID before loading the workspace.");
      return;
    }

    if (venueId.trim() !== trimmedVenueId) {
      setVenueId(trimmedVenueId);
      setActiveTab("papers");
      setExportError(null);
      window.sessionStorage.setItem(VENUE_STORAGE_KEY, trimmedVenueId);
    }

    setIsLoadingDashboard(true);
    setDashboardError(null);
    const loadId = createLoadId();
    startProgressPolling(trimmedVenueId, loadId);
    dashboardRequest.current?.abort();
    const requestController = new AbortController();
    dashboardRequest.current = requestController;

    let shouldAttemptRecovery = true;

    try {
      const timedResponse = await fetchWithTimeout(
        apiUrl(
          `/api/dashboard?venueId=${encodeURIComponent(trimmedVenueId)}&refresh=${refresh ? "1" : "0"}&loadId=${encodeURIComponent(loadId)}`,
          configuredApiOrigin
        ),
        { credentials: "include" },
        DASHBOARD_REQUEST_TIMEOUT_MS,
        "The dashboard request timed out while the API continued processing it.",
        requestController
      );
      const { response } = timedResponse;

      if (response.status === 401) {
        discardTimedResponse(timedResponse);
        shouldAttemptRecovery = false;
        handleSessionExpired(loadId);
        return;
      }

      if (!response.ok) {
        shouldAttemptRecovery = response.status >= 500 || response.status === 408 || response.status === 429;
        throw await responseError(timedResponse, "Could not load the selected venue.");
      }

      let payload: DashboardResponse;
      try {
        payload = await parseJson<DashboardResponse>(timedResponse);
      } catch {
        throw new Error("The dashboard API returned an invalid response.");
      }
      applyDashboardPayload(payload, trimmedVenueId, loadId);
    } catch (nextError) {
      if (activeLoadId.current !== loadId) {
        return;
      }
      if (nextError instanceof SessionExpiredError) {
        handleSessionExpired(loadId);
        return;
      }
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
            loadId,
            refresh
              ? "Loaded refreshed data after the local connection recovered."
              : "Loaded data after the local connection recovered."
          );
          return;
        } catch (recoveryError) {
          if (recoveryError instanceof SessionExpiredError) {
            handleSessionExpired(loadId);
            return;
          }
          if (activeLoadId.current !== loadId) {
            return;
          }
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
      if (dashboardRequest.current === requestController) {
        dashboardRequest.current = null;
      }
      if (activeLoadId.current === loadId) {
        stopProgressPolling(true);
      }
      setIsLoadingDashboard(false);
    }
  }

  async function handleLogin(username: string, password: string, nextVenueId: string) {
    if (!username || !password || !nextVenueId.trim()) {
      setAuthError("Enter your OpenReview email, password, and venue ID.");
      return;
    }

    setIsAuthenticating(true);
    setAuthError(null);

    try {
      const timedResponse = await fetchWithTimeout(
        apiUrl("/api/session/login", configuredApiOrigin),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          credentials: "include",
          body: JSON.stringify({ username, password })
        },
        LOGIN_REQUEST_TIMEOUT_MS,
        "Login timed out. Check your connection and try again."
      );
      const { response } = timedResponse;

      if (!response.ok) {
        throw await responseError(timedResponse, "Login failed.");
      }

      const nextViewer = await parseJson<ViewerInfo>(timedResponse);
      startTransition(() => {
        setViewer(nextViewer);
      });
      window.sessionStorage.setItem(VIEWER_STORAGE_KEY, JSON.stringify(nextViewer));
      await requestDashboard(nextVenueId, false);
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
      const timedResponse = await fetchWithTimeout(
        apiUrl("/api/session/logout", configuredApiOrigin),
        {
          method: "POST",
          credentials: "include"
        },
        SESSION_REQUEST_TIMEOUT_MS,
        "Sign out timed out. Your session may still be active."
      );
      const { response } = timedResponse;
      if (!response.ok) {
        throw await responseError(timedResponse, "Could not sign out. Your session is still active.");
      }
      discardTimedResponse(timedResponse);
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
      const timedResponse = await fetchWithTimeout(
        apiUrl(`/api/dashboard/export?venueId=${encodeURIComponent(dashboard.venue.venueId)}`, configuredApiOrigin),
        { credentials: "include" },
        EXPORT_REQUEST_TIMEOUT_MS,
        "Export timed out. Try again in a moment."
      );
      const { response } = timedResponse;

      if (response.status === 401) {
        discardTimedResponse(timedResponse);
        handleSessionExpired();
        return;
      }

      if (!response.ok) {
        throw await responseError(timedResponse, "Could not export the selected venue.");
      }

      const blob = await consumeTimedResponse(
        timedResponse,
        (nextResponse) => nextResponse.blob(),
        EXPORT_REQUEST_TIMEOUT_MS,
        "Export timed out while receiving the file. Try again in a moment."
      );
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

  function handleSessionExpired(loadId?: string) {
    if (loadId && activeLoadId.current !== loadId) {
      return;
    }
    clearClientSession();
    setAuthError("Your OpenReview session expired. Sign in again to continue.");
    setIsLoadingDashboard(false);
  }

  function clearClientSession() {
    stopProgressPolling(true);
    dashboardRequest.current?.abort();
    dashboardRequest.current = null;
    window.sessionStorage.removeItem(VIEWER_STORAGE_KEY);
    setViewer(null);
    setDashboard(null);
    setLoadProgress(null);
    setAuthError(null);
    setDashboardError(null);
  }

  const loadedDashboard =
    dashboard?.venue.venueId.trim() === venueId.trim() ? dashboard : null;
  const isBusy = isAuthenticating || isLoadingDashboard || isLoggingOut;
  const visibleTabs = loadedDashboard?.venue.stage === "Commitment Stage" ? COMMITMENT_TABS : TABS;
  const selectedTab = visibleTabs.some((tab) => tab.key === activeTab) ? activeTab : "papers";
  const venueStage = loadedDashboard?.venue.stage ?? getVenueStage(venueId);

  return (
    <div className="shell">
      <div className="shell-inner">
        <header className="shell-header">
          <Toolbar
            activeTab={selectedTab}
            isBusy={isBusy}
            isLoadingDashboard={isLoadingDashboard}
            isLoggingOut={isLoggingOut}
            lastSyncedAt={loadedDashboard?.venue.lastSyncedAt}
            onLoadOrRefresh={(nextVenueId) =>
              void requestDashboard(
                nextVenueId,
                Boolean(
                  dashboard?.venue.venueId &&
                    dashboard.venue.venueId.trim() === nextVenueId.trim()
                )
              )
            }
            onLogout={() => void handleLogout()}
            onTabChange={setActiveTab}
            recentVenueIds={recentVenueIds}
            showTabs={viewer && loadedDashboard ? true : false}
            tabs={visibleTabs}
            venueId={venueId}
            venueStage={venueStage}
            viewer={viewer}
          />
        </header>

        <main className="workspace">
          {hasRestoredSession && !viewer ? (
            <LoginPanel
              error={authError}
              isBusy={isAuthenticating}
              onLogin={handleLogin}
              onVenueIdChange={(value) => {
                setVenueId(value);
                window.sessionStorage.setItem(VENUE_STORAGE_KEY, value);
              }}
              venueId={venueId}
            />
          ) : null}

          {viewer && loadProgress && (!loadProgress.done || loadProgress.error) ? (
            <LoadProgressPanel progress={loadProgress} />
          ) : null}

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
                    totalPapers={loadedDashboard.summary.totalPapers}
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
                    totalComments={loadedDashboard.summary.commentsCount}
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

      </div>
    </div>
  );
}
