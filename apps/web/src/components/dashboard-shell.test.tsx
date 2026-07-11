import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DashboardShell } from "@/components/dashboard-shell";
import type { DashboardResponse } from "@/lib/types";
import { GITHUB_CHANGELOG_URL, GITHUB_PACKAGE_URL, GITHUB_REPOSITORY_URL, LOCAL_APP_VERSION } from "@/lib/version";

function createResponse(data: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => data
  } as Response;
}

function createFetchMock(...responses: Response[]) {
  const pendingResponses = [...responses];

  return vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) === GITHUB_PACKAGE_URL) {
      return createResponse({ version: "2.1.2" });
    }

    const nextResponse = pendingResponses.shift();
    if (!nextResponse) {
      throw new Error(`Unexpected fetch call: ${String(input)}`);
    }

    return nextResponse;
  });
}

function appFetchCalls(fetchMock: ReturnType<typeof createFetchMock>) {
  return fetchMock.mock.calls.filter(([input]) => String(input) !== GITHUB_PACKAGE_URL);
}

function apiRequestPath(input: RequestInfo | URL | string): string {
  const url = String(input);
  try {
    const parsed = new URL(url, window.location.origin);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

const dashboardFixture: DashboardResponse = {
  viewer: { id: "~Test_SAC1", fullname: "Test SAC" },
  venue: {
    venueId: "aclweb.org/ACL/ARR/2026/March",
    stage: "ARR Stage",
    submissionName: "Submission",
    lastSyncedAt: "2026-04-23T12:00:00.000Z"
  },
  summary: {
    totalPapers: 1,
    readyPapers: 1,
    metaReviewsDone: 1,
    commentsCount: 0,
    alertsCount: 1
  },
  papers: [
    {
      paperNumber: 42,
      paperId: "paper42",
      paperTitle: "A Careful Study of Reviewer Discussion Dynamics",
      paperType: "Long",
      areaChair: "~Area_Chair1",
      completedReviews: 3,
      expectedReviews: 3,
      readyForRebuttal: true,
      authorResponseReady: true,
      acChecklistReady: true,
      resubmission: false,
      preprint: false,
      hasConfidential: false,
      issueReport: false,
      reviewerConfidence: { average: 4, values: [4, 4, 4] },
      soundnessScore: { average: 3.5, values: [3, 4, 3.5] },
      excitementScore: { average: 3.5, values: [3, 4, 3.5] },
      overallAssessment: { average: 4, values: [4, 4, 4] },
      metaReviewScore: 4,
      metaReviewText: "",
      responseToMetaReview: "",
      forumUrl: "https://openreview.net/forum?id=paper42"
    }
  ],
  areaChairs: [
    {
      areaChair: "~Area_Chair1",
      areaChairName: "Area Chair One",
      areaChairEmail: "chair1@example.com",
      totalCompletedReviews: 3,
      totalExpectedReviews: 3,
      papersReady: 1,
      numPapers: 1,
      allReviewsReady: true,
      metaReviewsDone: 1,
      acChecklistDone: 1,
      allMetaReviewsReady: true
    }
  ],
  withdrawnPapers: [],
  comments: [],
  alerts: [
    {
      paperNumber: 42,
      paperId: "paper42",
      paperTitle: "A Careful Study of Reviewer Discussion Dynamics",
      forumUrl: "https://openreview.net/forum?id=paper42",
      items: [
        {
          noteId: "delay-alert",
          paperNumber: 42,
          paperId: "paper42",
          type: "Delay Notification",
          role: "Reviewer",
          signerLabel: "Reviewer REii",
          date: "2026-07-03",
          content: "**Notification:** I need four more days.",
          link: "https://openreview.net/forum?id=paper42&noteId=delay-alert",
          children: []
        }
      ]
    }
  ],
  analytics: {
    overallAssessmentHistogram: [],
    metaReviewDistribution: [],
    pairedScatter: []
  }
};

const commitmentDashboardFixture: DashboardResponse = {
  ...dashboardFixture,
  venue: {
    venueId: "aclweb.org/ACL/2026/Conference",
    stage: "Commitment Stage",
    submissionName: "Commitment",
    lastSyncedAt: "2026-04-23T12:00:00.000Z"
  },
  areaChairs: []
};

function restoreViewer() {
  window.sessionStorage.setItem(
    "arr-sac-dashboard.viewer",
    JSON.stringify(dashboardFixture.viewer)
  );
}

async function openAccountMenu(user: ReturnType<typeof userEvent.setup>) {
  const trigger = await screen.findByRole("button", { name: dashboardFixture.viewer.fullname });
  if (trigger.getAttribute("aria-expanded") !== "true") {
    await user.click(trigger);
  }
  return screen.getByLabelText("Venue ID");
}

async function signInAndLoad(
  user: ReturnType<typeof userEvent.setup>,
  venueId = dashboardFixture.venue.venueId
) {
  const venueInput = screen.getByLabelText<HTMLInputElement>("Venue ID");
  if (venueInput.value !== venueId) {
    await user.clear(venueInput);
    await user.type(venueInput, venueId);
  }
  await user.type(screen.getByLabelText(/openreview email/i), "demo@example.com");
  await user.type(screen.getByLabelText(/password/i), "secret");
  await user.click(screen.getByRole("button", { name: /sign in & load venue/i }));
}

describe("DashboardShell", () => {
  it("does not render the inline login before client session restoration", () => {
    const markup = renderToString(createElement(DashboardShell));

    expect(markup).not.toContain("login-panel");
    expect(markup).not.toContain("Sign in &amp; load venue");
  });

  it("signs in and loads the selected venue in one action", async () => {
    const fetchMock = createFetchMock(
      createResponse(dashboardFixture.viewer),
      createResponse(dashboardFixture),
      createResponse(dashboardFixture)
    );

    vi.stubGlobal("fetch", fetchMock);

    render(createElement(DashboardShell));

    const user = userEvent.setup();
    expect(screen.getByRole("link", { name: /open ymcui\/arr-sac-tool on github/i })).toHaveAttribute(
      "href",
      GITHUB_REPOSITORY_URL
    );
    expect(screen.getByText(`v${LOCAL_APP_VERSION}`)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByLabelText("Venue ID")).toHaveValue("aclweb.org/ACL/ARR/2026/May");
    expect(screen.getByText("ARR Stage")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await signInAndLoad(user);

    const accountTrigger = await screen.findByRole("button", { name: "Test SAC" });
    expect(accountTrigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(accountTrigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("region", { name: "Sign in" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: /account and venue settings/i })).not.toBeInTheDocument();

    expect(await screen.findByRole("tab", { name: "Papers" })).toBeInTheDocument();
    expect(await screen.findByRole("tab", { name: "Alerts" })).toBeInTheDocument();
    expect(await screen.findByText("Paper workspace")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "42" })).toBeInTheDocument();
    expect(accountTrigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Venue ID")).not.toBeInTheDocument();
    const stagePill = screen.getByText("ARR Stage");
    expect(stagePill.parentElement).toContainElement(screen.getByText(/^Last sync:/i));
    expect(screen.queryByText("paper42")).not.toBeInTheDocument();
    expect(screen.queryByText("Load a venue.")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/batch summary/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Loaded 1 papers for this SAC batch.")).not.toBeInTheDocument();

    await waitFor(() => {
      expect(appFetchCalls(fetchMock)).toHaveLength(2);
    });
    expect(String(appFetchCalls(fetchMock)[1][0])).toContain("refresh=0");
    await waitFor(() => {
      expect(JSON.parse(window.localStorage.getItem("arr-sac-dashboard.recent-venues") || "[]")).toEqual([
        "aclweb.org/ACL/ARR/2026/March",
        "aclweb.org/ACL/ARR/2026/May"
      ]);
    });
    await user.click(accountTrigger);
    expect(accountTrigger).toHaveAttribute("aria-expanded", "true");
    expect(await screen.findByRole("dialog", { name: /account and venue settings/i })).toBeInTheDocument();
    expect(screen.getByLabelText("Venue ID")).toHaveValue("aclweb.org/ACL/ARR/2026/March");
    expect(screen.getByRole("button", { name: /^logout$/i })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /load \/ refresh/i })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: /load \/ refresh/i }));
    await waitFor(() => {
      expect(appFetchCalls(fetchMock)).toHaveLength(3);
    });
    expect(String(appFetchCalls(fetchMock)[2][0])).toContain("refresh=1");
  });

  it("passes API summary totals through to paper and comment title pills", async () => {
    const summaryTotalsDashboard: DashboardResponse = {
      ...dashboardFixture,
      summary: {
        ...dashboardFixture.summary,
        totalPapers: 17,
        commentsCount: 19
      }
    };
    vi.stubGlobal(
      "fetch",
      createFetchMock(
        createResponse(summaryTotalsDashboard.viewer),
        createResponse(summaryTotalsDashboard)
      )
    );
    render(createElement(DashboardShell));
    const user = userEvent.setup();

    await signInAndLoad(user);

    expect(await screen.findByLabelText("17 papers")).toHaveTextContent("17");
    expect(screen.queryByLabelText("1 papers")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Comments" }));

    expect(screen.getByLabelText("19 comments")).toHaveTextContent("19");
    expect(screen.queryByLabelText("0 comments")).not.toBeInTheDocument();
  });

  it("uses the direct API origin for local dev pages instead of the Next rewrite proxy", async () => {
    const fetchMock = createFetchMock(
      createResponse(dashboardFixture.viewer),
      createResponse(dashboardFixture)
    );

    vi.stubGlobal("fetch", fetchMock);

    render(createElement(DashboardShell));

    const user = userEvent.setup();
    await signInAndLoad(user);

    expect(await screen.findByRole("button", { name: "42" })).toBeInTheDocument();

    const requestUrls = appFetchCalls(fetchMock).map(([input]) => String(input));
    expect(requestUrls[0]).toBe("http://127.0.0.1:8001/api/session/login");
    expect(requestUrls[1]).toContain("http://127.0.0.1:8001/api/dashboard?");
    expect(requestUrls[1]).toContain("refresh=0");
  });

  it("uses the runtime API origin provided by the server page for local pages", async () => {
    const fetchMock = createFetchMock(
      createResponse(dashboardFixture.viewer),
      createResponse(dashboardFixture)
    );

    vi.stubGlobal("fetch", fetchMock);

    render(createElement(DashboardShell, { configuredApiOrigin: "http://127.0.0.1:8124" }));

    const user = userEvent.setup();
    await signInAndLoad(user);

    expect(await screen.findByRole("button", { name: "42" })).toBeInTheDocument();

    const requestUrls = appFetchCalls(fetchMock).map(([input]) => String(input));
    expect(requestUrls[0]).toBe("http://127.0.0.1:8124/api/session/login");
    expect(requestUrls[1]).toContain("http://127.0.0.1:8124/api/dashboard?");
    expect(requestUrls[1]).toContain("refresh=0");
  });

  it("recovers a refresh when the long dashboard request disconnects after the backend finishes", async () => {
    const refreshedDashboardFixture: DashboardResponse = {
      ...dashboardFixture,
      venue: {
        ...dashboardFixture.venue,
        lastSyncedAt: "2026-04-24T12:00:00.000Z"
      },
      papers: [
        {
          ...dashboardFixture.papers[0],
          paperNumber: 77,
          paperId: "paper77",
          paperTitle: "Recovered Refresh Paper",
          forumUrl: "https://openreview.net/forum?id=paper77"
        }
      ]
    };
    let cachedDashboardCalls = 0;
    let currentRefreshLoadId: string | null = null;
    let recoveryProgressCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url === GITHUB_PACKAGE_URL) {
        return createResponse({ version: "2.1.2" });
      }

      if (apiRequestPath(url) === "/api/session/login") {
        return createResponse(dashboardFixture.viewer);
      }

      if (apiRequestPath(url).startsWith("/api/dashboard/progress")) {
        recoveryProgressCalls += 1;
        if (recoveryProgressCalls === 1) {
          return createResponse({
            venueId: dashboardFixture.venue.venueId,
            loadId: "previous-load",
            phase: "ready",
            message: "Loaded stale workspace.",
            current: 1,
            total: 1,
            done: true,
            error: null
          });
        }

        return createResponse({
          venueId: dashboardFixture.venue.venueId,
          loadId: currentRefreshLoadId,
          phase: "ready",
          message: "Loaded refreshed workspace.",
          current: 1,
          total: 1,
          done: true,
          error: null
        });
      }

      if (apiRequestPath(url).startsWith("/api/dashboard?") && url.includes("refresh=0")) {
        cachedDashboardCalls += 1;
        return createResponse(cachedDashboardCalls === 1 ? dashboardFixture : refreshedDashboardFixture);
      }

      if (apiRequestPath(url).startsWith("/api/dashboard?") && url.includes("refresh=1")) {
        currentRefreshLoadId = new URL(url, "http://localhost").searchParams.get("loadId");
        throw new TypeError("The string did not match the expected pattern.");
      }

      throw new Error(`Unexpected fetch call: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    render(createElement(DashboardShell));

    const user = userEvent.setup();
    await signInAndLoad(user);

    expect(await screen.findByRole("button", { name: "42" })).toBeInTheDocument();

    await openAccountMenu(user);
    await user.click(screen.getByRole("button", { name: /load \/ refresh/i }));

    expect(await screen.findByRole("button", { name: "77" }, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.queryByText("The string did not match the expected pattern.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "42" })).not.toBeInTheDocument();

    const requestUrls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(requestUrls.some((url) => url.includes("refresh=1"))).toBe(true);
    expect(requestUrls.some((url) => apiRequestPath(url).startsWith("/api/dashboard/progress"))).toBe(true);
    expect(recoveryProgressCalls).toBeGreaterThanOrEqual(2);
    expect(
      requestUrls.filter((url) => apiRequestPath(url).startsWith("/api/dashboard?") && url.includes("refresh=0"))
    ).toHaveLength(2);
  });

  it("recovers an initial load when the long dashboard request disconnects after the backend finishes", async () => {
    let currentLoadId: string | null = null;
    let cachedDashboardCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url === GITHUB_PACKAGE_URL) {
        return createResponse({ version: "2.1.2" });
      }

      if (apiRequestPath(url) === "/api/session/login") {
        return createResponse(dashboardFixture.viewer);
      }

      if (apiRequestPath(url).startsWith("/api/dashboard/progress")) {
        return createResponse({
          venueId: dashboardFixture.venue.venueId,
          loadId: currentLoadId,
          phase: "ready",
          message: "Loaded workspace.",
          current: 1,
          total: 1,
          done: true,
          error: null
        });
      }

      if (apiRequestPath(url).startsWith("/api/dashboard?") && url.includes("refresh=0")) {
        cachedDashboardCalls += 1;
        currentLoadId = new URL(url, "http://localhost").searchParams.get("loadId");
        if (cachedDashboardCalls === 1) {
          throw new TypeError("The string did not match the expected pattern.");
        }
        return createResponse(dashboardFixture);
      }

      throw new Error(`Unexpected fetch call: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    render(createElement(DashboardShell));

    const user = userEvent.setup();
    await signInAndLoad(user);

    expect(await screen.findByRole("button", { name: "42" }, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.queryByText("The string did not match the expected pattern.")).not.toBeInTheDocument();

    const requestUrls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(requestUrls.some((url) => apiRequestPath(url).startsWith("/api/dashboard/progress"))).toBe(true);
    expect(
      requestUrls.filter((url) => apiRequestPath(url).startsWith("/api/dashboard?") && url.includes("refresh=0"))
    ).toHaveLength(2);
  });

  it("recovers an initial load after a proxy 5xx response with a non-JSON body", async () => {
    let currentLoadId: string | null = null;
    let dashboardCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === GITHUB_PACKAGE_URL) {
        return createResponse({ version: "2.1.2" });
      }
      if (apiRequestPath(url) === "/api/session/login") {
        return createResponse(dashboardFixture.viewer);
      }
      if (apiRequestPath(url).startsWith("/api/dashboard/progress")) {
        return createResponse({
          venueId: dashboardFixture.venue.venueId,
          loadId: currentLoadId,
          phase: "ready",
          message: "Loaded workspace.",
          current: 1,
          total: 1,
          done: true,
          error: null
        });
      }
      if (apiRequestPath(url).startsWith("/api/dashboard?")) {
        dashboardCalls += 1;
        currentLoadId = new URL(url, "http://localhost").searchParams.get("loadId");
        return dashboardCalls === 1
          ? createResponse("<html>Bad gateway</html>", false, 502)
          : createResponse(dashboardFixture);
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(createElement(DashboardShell));
    const user = userEvent.setup();

    await signInAndLoad(user);

    expect(await screen.findByRole("button", { name: "42" })).toBeInTheDocument();
    expect(dashboardCalls).toBe(2);
  });

  it("reopens login when the progress endpoint reports an expired session", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = String(input);
        if (url === GITHUB_PACKAGE_URL) {
          return createResponse({ version: "2.1.2" });
        }
        if (apiRequestPath(url) === "/api/session/login") {
          return createResponse(dashboardFixture.viewer);
        }
        if (apiRequestPath(url).startsWith("/api/dashboard/progress")) {
          return createResponse({}, false, 401);
        }
        if (apiRequestPath(url).startsWith("/api/dashboard?")) {
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("The operation was aborted.", "AbortError")),
              { once: true }
            );
          });
        }
        throw new Error(`Unexpected fetch call: ${url}`);
      }
    );
    vi.stubGlobal("fetch", fetchMock);
    render(createElement(DashboardShell));
    const user = userEvent.setup();

    await signInAndLoad(user);

    expect(
      await screen.findByRole("region", { name: "Sign in" }, { timeout: 2500 })
    ).toBeInTheDocument();
    expect(screen.getByText(/your openreview session expired/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^logout$/i })).not.toBeInTheDocument();
  });

  it("ignores a delayed progress response after the matching dashboard load completes", async () => {
    let currentLoadId: string | null = null;
    let resolveDashboard!: (response: Response) => void;
    let resolveProgress!: (response: Response) => void;
    const dashboardResponse = new Promise<Response>((resolve) => {
      resolveDashboard = resolve;
    });
    const progressResponse = new Promise<Response>((resolve) => {
      resolveProgress = resolve;
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      if (url === GITHUB_PACKAGE_URL) {
        return createResponse({ version: "2.1.2" });
      }
      if (apiRequestPath(url) === "/api/session/login") {
        return createResponse(dashboardFixture.viewer);
      }
      if (apiRequestPath(url).startsWith("/api/dashboard/progress")) {
        return progressResponse;
      }
      if (apiRequestPath(url).startsWith("/api/dashboard?")) {
        currentLoadId = new URL(url, "http://localhost").searchParams.get("loadId");
        return dashboardResponse;
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(createElement(DashboardShell));
    const user = userEvent.setup();

    await signInAndLoad(user);

    await waitFor(
      () => {
        expect(
          fetchMock.mock.calls.some(([input]) =>
            apiRequestPath(input).startsWith("/api/dashboard/progress")
          )
        ).toBe(true);
      },
      { timeout: 2500 }
    );

    await act(async () => {
      resolveDashboard(createResponse(dashboardFixture));
    });
    expect(await screen.findByRole("button", { name: "42" })).toBeInTheDocument();

    await act(async () => {
      resolveProgress(
        createResponse({
          venueId: dashboardFixture.venue.venueId,
          loadId: currentLoadId,
          phase: "papers",
          message: "Delayed stale progress.",
          current: 0,
          total: 1,
          done: false,
          error: null
        })
      );
    });

    expect(screen.queryByText("Delayed stale progress.")).not.toBeInTheDocument();
  });

  it("bounds login requests and reports a useful timeout", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn(
        async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
          const url = String(input);
          if (url === GITHUB_PACKAGE_URL) {
            return createResponse({ version: "2.1.2" });
          }
          if (apiRequestPath(url) === "/api/session/login") {
            return new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener(
                "abort",
                () => reject(new DOMException("The operation was aborted.", "AbortError")),
                { once: true }
              );
            });
          }
          throw new Error(`Unexpected fetch call: ${url}`);
        }
      );
      vi.stubGlobal("fetch", fetchMock);
      render(createElement(DashboardShell));

      fireEvent.change(screen.getByLabelText(/openreview email/i), {
        target: { value: "demo@example.com" }
      });
      fireEvent.change(screen.getByLabelText(/password/i), { target: { value: "secret" } });
      fireEvent.click(screen.getByRole("button", { name: /sign in & load venue/i }));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(195000);
      });

      expect(screen.getByText(/login timed out/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /sign in & load venue/i })).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("aborts stalled login response bodies", async () => {
    vi.useFakeTimers();
    try {
      let loginSignal: AbortSignal | null = null;
      const fetchMock = vi.fn(
        async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
          const url = String(input);
          if (url === GITHUB_PACKAGE_URL) {
            return createResponse({ version: "2.1.2" });
          }
          if (apiRequestPath(url) === "/api/session/login") {
            loginSignal = init?.signal ?? null;
            return {
              ok: true,
              status: 200,
              json: () => new Promise<never>(() => undefined)
            } as Response;
          }
          throw new Error(`Unexpected fetch call: ${url}`);
        }
      );
      vi.stubGlobal("fetch", fetchMock);
      render(createElement(DashboardShell));

      fireEvent.change(screen.getByLabelText(/openreview email/i), {
        target: { value: "demo@example.com" }
      });
      fireEvent.change(screen.getByLabelText(/password/i), { target: { value: "secret" } });
      fireEvent.click(screen.getByRole("button", { name: /sign in & load venue/i }));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(15000);
      });

      expect(loginSignal).not.toBeNull();
      expect(loginSignal?.aborted).toBe(true);
      expect(screen.getByText(/server response did not finish in time/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /sign in & load venue/i })).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds stalled progress response bodies and aborts the poll", async () => {
    vi.useFakeTimers();
    try {
      let progressSignal: AbortSignal | null = null;
      const fetchMock = vi.fn(
        async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
          const url = String(input);
          if (url === GITHUB_PACKAGE_URL) {
            return createResponse({ version: "2.1.2" });
          }
          if (apiRequestPath(url) === "/api/session/login") {
            return createResponse(dashboardFixture.viewer);
          }
          if (apiRequestPath(url).startsWith("/api/dashboard/progress")) {
            progressSignal = init?.signal ?? null;
            return new Promise<Response>((resolve) => {
              window.setTimeout(
                () =>
                  resolve({
                    ok: true,
                    status: 200,
                    json: () => new Promise<never>(() => undefined)
                  } as Response),
                3000
              );
            });
          }
          if (apiRequestPath(url).startsWith("/api/dashboard?")) {
            return new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener(
                "abort",
                () => reject(new DOMException("The operation was aborted.", "AbortError")),
                { once: true }
              );
            });
          }
          throw new Error(`Unexpected fetch call: ${url}`);
        }
      );
      vi.stubGlobal("fetch", fetchMock);
      render(createElement(DashboardShell));

      fireEvent.change(screen.getByLabelText(/openreview email/i), {
        target: { value: "demo@example.com" }
      });
      fireEvent.change(screen.getByLabelText(/password/i), { target: { value: "secret" } });
      fireEvent.click(screen.getByRole("button", { name: /sign in & load venue/i }));
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      const progressStatus = screen.getByRole("status", { name: "Venue loading progress" });
      expect(progressStatus).toHaveTextContent("Venue");
      expect(progressStatus).toHaveTextContent("Working");
      expect(progressStatus).toHaveTextContent("Starting venue load...");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
        await vi.advanceTimersByTimeAsync(4000);
      });

      expect(progressSignal).not.toBeNull();
      expect(progressSignal?.aborted).toBe(true);
      const progressCalls = fetchMock.mock.calls.filter(([input]) =>
        apiRequestPath(input).startsWith("/api/dashboard/progress")
      );
      expect(progressCalls).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows actionable guidance when a disconnected dashboard load cannot be recovered", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url === GITHUB_PACKAGE_URL) {
        return createResponse({ version: "2.1.2" });
      }

      if (apiRequestPath(url) === "/api/session/login") {
        return createResponse(dashboardFixture.viewer);
      }

      if (apiRequestPath(url).startsWith("/api/dashboard/progress")) {
        throw new TypeError("The string did not match the expected pattern.");
      }

      if (apiRequestPath(url).startsWith("/api/dashboard?") && url.includes("refresh=0")) {
        throw new TypeError("The string did not match the expected pattern.");
      }

      throw new Error(`Unexpected fetch call: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    render(createElement(DashboardShell));

    const user = userEvent.setup();
    await signInAndLoad(user);

    expect(
      await screen.findByText(/the dashboard connection was interrupted before data could be loaded/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/refresh this page and sign in again if prompted/i)).toBeInTheDocument();
  });

  it("offers recent valid venue IDs as soft dropdown suggestions", async () => {
    restoreViewer();
    window.localStorage.setItem(
      "arr-sac-dashboard.recent-venues",
      JSON.stringify(["aclweb.org/ACL/2026/Conference", "aclweb.org/ACL/ARR/2026/March"])
    );
    vi.stubGlobal("fetch", createFetchMock());

    render(createElement(DashboardShell));
    const user = userEvent.setup();

    const input = await openAccountMenu(user);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    await user.click(input);
    await user.clear(input);

    expect(await screen.findByRole("listbox")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "aclweb.org/ACL/2026/Conference" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "aclweb.org/ACL/ARR/2026/March" })).toBeInTheDocument();
  });

  it("filters recent venues using the current venue draft", async () => {
    restoreViewer();
    window.localStorage.setItem(
      "arr-sac-dashboard.recent-venues",
      JSON.stringify(["aclweb.org/ACL/2026/Conference", "aclweb.org/ACL/ARR/2026/March"])
    );
    vi.stubGlobal("fetch", createFetchMock());

    render(createElement(DashboardShell));
    const user = userEvent.setup();
    const input = await openAccountMenu(user);

    await user.click(input);
    await user.clear(input);
    await user.type(input, "Conference");
    expect(screen.queryByRole("option", { name: "aclweb.org/ACL/ARR/2026/March" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: "aclweb.org/ACL/2026/Conference" }));

    expect(input).toHaveValue("aclweb.org/ACL/2026/Conference");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("selects recent venues from the keyboard without moving focus out of the input", async () => {
    restoreViewer();
    window.localStorage.setItem(
      "arr-sac-dashboard.recent-venues",
      JSON.stringify(["aclweb.org/ACL/2026/Conference", "aclweb.org/ACL/ARR/2026/March"])
    );
    vi.stubGlobal("fetch", createFetchMock());

    render(createElement(DashboardShell));
    const user = userEvent.setup();
    const input = await openAccountMenu(user);

    await user.click(input);
    await user.clear(input);
    await user.keyboard("{ArrowDown}");

    expect(input).toHaveAttribute("aria-activedescendant", "account-recent-venue-ids-option-0");
    expect(input).toHaveFocus();
    expect(
      screen.getAllByRole("option").filter((option) => option.getAttribute("aria-selected") === "true")
    ).toHaveLength(1);

    await user.keyboard("{Enter}");

    expect(input).toHaveValue("aclweb.org/ACL/2026/Conference");
    expect(input).toHaveFocus();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("keeps the current stage while a different venue is only a draft", async () => {
    restoreViewer();
    vi.stubGlobal("fetch", createFetchMock());

    render(createElement(DashboardShell));

    const user = userEvent.setup();
    const input = await openAccountMenu(user);
    await user.clear(input);
    await user.type(input, "aclweb.org/ACL/2026/Conference");

    expect(screen.getByText("ARR Stage")).toBeInTheDocument();
    expect(screen.queryByText("Commitment Stage")).not.toBeInTheDocument();
  });

  it("keeps loaded data while a venue draft remains unapplied", async () => {
    vi.stubGlobal(
      "fetch",
      createFetchMock(createResponse(dashboardFixture.viewer), createResponse(dashboardFixture))
    );
    render(createElement(DashboardShell));
    const user = userEvent.setup();

    await signInAndLoad(user);
    expect(await screen.findByRole("button", { name: "42" })).toBeInTheDocument();

    const input = await openAccountMenu(user);
    await user.type(input, "-different");

    expect(screen.getByRole("button", { name: "42" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Papers" })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await user.keyboard("{Escape}");
    expect(screen.queryByLabelText("Venue ID")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Test SAC" })).toHaveFocus();

    const reopenedInput = await openAccountMenu(user);
    expect(reopenedInput).toHaveValue("aclweb.org/ACL/ARR/2026/March-different");
  });

  it("hides the previous venue after a different venue load is submitted", async () => {
    vi.stubGlobal(
      "fetch",
      createFetchMock(
        createResponse(dashboardFixture.viewer),
        createResponse(dashboardFixture),
        createResponse({ detail: "Unknown venue." }, false, 404)
      )
    );
    render(createElement(DashboardShell));
    const user = userEvent.setup();

    await signInAndLoad(user);
    expect(await screen.findByRole("button", { name: "42" })).toBeInTheDocument();

    const input = await openAccountMenu(user);
    await user.clear(input);
    await user.type(input, "aclweb.org/ACL/2026/Conference");
    await user.click(screen.getByRole("button", { name: /load \/ refresh/i }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "42" })).not.toBeInTheDocument();
    });
    expect(screen.queryByRole("tab", { name: "Papers" })).not.toBeInTheDocument();
    expect(screen.getByText("Commitment Stage")).toBeInTheDocument();
    expect(await screen.findAllByText("Unknown venue.")).not.toHaveLength(0);
    expect(window.sessionStorage.getItem("arr-sac-dashboard.venue")).toBe(
      "aclweb.org/ACL/2026/Conference"
    );
  });

  it("restores the selected venue context when retrying a retained dashboard after a failed switch", async () => {
    const fetchMock = createFetchMock(
      createResponse(dashboardFixture.viewer),
      createResponse(dashboardFixture),
      createResponse({ detail: "Unknown venue." }, false, 404),
      createResponse({ detail: "Refresh failed." }, false, 404)
    );
    vi.stubGlobal("fetch", fetchMock);
    render(createElement(DashboardShell));
    const user = userEvent.setup();

    await signInAndLoad(user);
    expect(await screen.findByRole("button", { name: "42" })).toBeInTheDocument();

    const differentVenueInput = await openAccountMenu(user);
    await user.clear(differentVenueInput);
    await user.type(differentVenueInput, "aclweb.org/ACL/2026/Conference");
    await user.click(screen.getByRole("button", { name: /load \/ refresh/i }));

    expect(await screen.findAllByText("Unknown venue.")).not.toHaveLength(0);
    expect(screen.queryByRole("button", { name: "42" })).not.toBeInTheDocument();
    expect(window.sessionStorage.getItem("arr-sac-dashboard.venue")).toBe(
      "aclweb.org/ACL/2026/Conference"
    );

    const retainedVenueInput = await openAccountMenu(user);
    await user.clear(retainedVenueInput);
    await user.type(retainedVenueInput, dashboardFixture.venue.venueId);
    await user.click(screen.getByRole("button", { name: /load \/ refresh/i }));

    expect(await screen.findAllByText("Refresh failed.")).not.toHaveLength(0);
    expect(screen.getByText("ARR Stage")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "42" })).toBeInTheDocument();
    expect(window.sessionStorage.getItem("arr-sac-dashboard.venue")).toBe(
      dashboardFixture.venue.venueId
    );
    expect(apiRequestPath(appFetchCalls(fetchMock)[3][0])).toContain("refresh=1");
  });

  it("keeps the client session when logout fails", async () => {
    vi.stubGlobal(
      "fetch",
      createFetchMock(
        createResponse(dashboardFixture.viewer),
        createResponse(dashboardFixture),
        createResponse({}, false, 503)
      )
    );
    render(createElement(DashboardShell));
    const user = userEvent.setup();

    await signInAndLoad(user);
    await openAccountMenu(user);
    await user.click(await screen.findByRole("button", { name: /^logout$/i }));

    expect(await screen.findByText(/could not sign out/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^logout$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "42" })).toBeInTheDocument();
  });

  it("logs out successfully even when recent venue suggestions are open", async () => {
    const fetchMock = createFetchMock(
      createResponse(dashboardFixture.viewer),
      createResponse(dashboardFixture),
      createResponse({ status: "ok" })
    );
    vi.stubGlobal("fetch", fetchMock);
    render(createElement(DashboardShell));
    const user = userEvent.setup();

    await signInAndLoad(user);
    expect(await screen.findByRole("button", { name: "42" })).toBeInTheDocument();

    const input = await openAccountMenu(user);
    await user.click(input);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^logout$/i }));

    expect(await screen.findByRole("region", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Test SAC" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "42" })).not.toBeInTheDocument();
    expect(window.sessionStorage.getItem("arr-sac-dashboard.viewer")).toBeNull();
    expect(appFetchCalls(fetchMock)).toHaveLength(3);
    expect(apiRequestPath(appFetchCalls(fetchMock)[2][0])).toBe("/api/session/logout");
  });

  it("omits the Area Chairs tab for commitment stage dashboards", async () => {
    const fetchMock = createFetchMock(
      createResponse(commitmentDashboardFixture.viewer),
      createResponse(commitmentDashboardFixture)
    );

    vi.stubGlobal("fetch", fetchMock);

    render(createElement(DashboardShell));

    const user = userEvent.setup();
    await signInAndLoad(user, "aclweb.org/ACL/2026/Conference");

    expect(await screen.findByRole("tab", { name: "Papers" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Area Chairs" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Alerts" })).not.toBeInTheDocument();
    expect(screen.getByText("Commitment Stage")).toBeInTheDocument();
  });

  it("shows an update notice when GitHub has a newer version", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === GITHUB_PACKAGE_URL) {
        return createResponse({ version: "99.0.0" });
      }

      throw new Error(`Unexpected fetch call: ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(createElement(DashboardShell));

    expect(
      await screen.findByRole("link", {
        name: /update available: local version v.+latest version v99\.0\.0/i
      })
    ).toHaveAttribute("href", GITHUB_CHANGELOG_URL);
    expect(screen.getByText("Update available: v99.0.0")).toBeInTheDocument();
  });
});
