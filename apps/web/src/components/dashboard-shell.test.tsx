import { createElement } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
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

describe("DashboardShell", () => {
  it("logs in first and loads the venue only after an explicit action", async () => {
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
    expect(screen.getByLabelText("Venue ID")).toHaveValue("aclweb.org/ACL/ARR/2026/March");
    expect(screen.getByText("ARR Stage")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^login$/i }));
    await user.type(screen.getByLabelText(/openreview email/i), "demo@example.com");
    await user.type(screen.getByLabelText(/password/i), "secret");
    await user.click(screen.getByRole("button", { name: /sign in to openreview/i }));

    expect(await screen.findByRole("button", { name: /^logout$/i })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /load \/ refresh/i })).toBeEnabled();
    expect(appFetchCalls(fetchMock)).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: /load \/ refresh/i }));

    expect(await screen.findByRole("tab", { name: "Papers" })).toBeInTheDocument();
    expect(await screen.findByRole("tab", { name: "Alerts" })).toBeInTheDocument();
    expect(await screen.findByText("Paper workspace")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "42" })).toBeInTheDocument();
    const venueSummary = await screen.findByLabelText("Venue summary");
    expect(within(venueSummary).getByText("Paper #")).toBeInTheDocument();
    expect(within(venueSummary).getByText("AC #")).toBeInTheDocument();
    expect(within(venueSummary).getAllByText("1")).toHaveLength(2);
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
        "aclweb.org/ACL/ARR/2026/March"
      ]);
    });
    await user.click(screen.getByRole("button", { name: /load \/ refresh/i }));
    await waitFor(() => {
      expect(appFetchCalls(fetchMock)).toHaveLength(3);
    });
    expect(String(appFetchCalls(fetchMock)[2][0])).toContain("refresh=1");
  });

  it("uses the direct API origin for local dev pages instead of the Next rewrite proxy", async () => {
    const fetchMock = createFetchMock(
      createResponse(dashboardFixture.viewer),
      createResponse(dashboardFixture)
    );

    vi.stubGlobal("fetch", fetchMock);

    render(createElement(DashboardShell));

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^login$/i }));
    await user.type(screen.getByLabelText(/openreview email/i), "demo@example.com");
    await user.type(screen.getByLabelText(/password/i), "secret");
    await user.click(screen.getByRole("button", { name: /sign in to openreview/i }));
    await user.click(await screen.findByRole("button", { name: /load \/ refresh/i }));

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
    await user.click(screen.getByRole("button", { name: /^login$/i }));
    await user.type(screen.getByLabelText(/openreview email/i), "demo@example.com");
    await user.type(screen.getByLabelText(/password/i), "secret");
    await user.click(screen.getByRole("button", { name: /sign in to openreview/i }));
    await user.click(await screen.findByRole("button", { name: /load \/ refresh/i }));

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
    await user.click(screen.getByRole("button", { name: /^login$/i }));
    await user.type(screen.getByLabelText(/openreview email/i), "demo@example.com");
    await user.type(screen.getByLabelText(/password/i), "secret");
    await user.click(screen.getByRole("button", { name: /sign in to openreview/i }));
    await user.click(await screen.findByRole("button", { name: /load \/ refresh/i }));

    expect(await screen.findByRole("button", { name: "42" })).toBeInTheDocument();

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
    await user.click(screen.getByRole("button", { name: /^login$/i }));
    await user.type(screen.getByLabelText(/openreview email/i), "demo@example.com");
    await user.type(screen.getByLabelText(/password/i), "secret");
    await user.click(screen.getByRole("button", { name: /sign in to openreview/i }));
    await user.click(await screen.findByRole("button", { name: /load \/ refresh/i }));

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

    await user.click(screen.getByRole("button", { name: /^login$/i }));
    await user.type(screen.getByLabelText(/openreview email/i), "demo@example.com");
    await user.type(screen.getByLabelText(/password/i), "secret");
    await user.click(screen.getByRole("button", { name: /sign in to openreview/i }));
    await user.click(await screen.findByRole("button", { name: /load \/ refresh/i }));

    expect(await screen.findByRole("button", { name: "42" })).toBeInTheDocument();
    expect(dashboardCalls).toBe(2);
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
    await user.click(screen.getByRole("button", { name: /^login$/i }));
    await user.type(screen.getByLabelText(/openreview email/i), "demo@example.com");
    await user.type(screen.getByLabelText(/password/i), "secret");
    await user.click(screen.getByRole("button", { name: /sign in to openreview/i }));
    await user.click(await screen.findByRole("button", { name: /load \/ refresh/i }));

    expect(await screen.findByText("The string did not match the expected pattern.")).toBeInTheDocument();
    expect(
      screen.getByText(/the dashboard connection was interrupted before data could be loaded/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/refresh this page and sign in again if prompted/i)).toBeInTheDocument();
  });

  it("offers recent valid venue IDs as soft dropdown suggestions", async () => {
    window.localStorage.setItem(
      "arr-sac-dashboard.recent-venues",
      JSON.stringify(["aclweb.org/ACL/2026/Conference", "aclweb.org/ACL/ARR/2026/March"])
    );
    vi.stubGlobal("fetch", createFetchMock());

    render(createElement(DashboardShell));
    const user = userEvent.setup();

    await user.click(screen.getByLabelText("Venue ID"));

    expect(await screen.findByRole("listbox")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "aclweb.org/ACL/2026/Conference" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "aclweb.org/ACL/ARR/2026/March" })).toBeInTheDocument();
  });

  it("selects a recent venue without filtering the dropdown to the current value", async () => {
    window.localStorage.setItem(
      "arr-sac-dashboard.recent-venues",
      JSON.stringify(["aclweb.org/ACL/2026/Conference", "aclweb.org/ACL/ARR/2026/March"])
    );
    vi.stubGlobal("fetch", createFetchMock());

    render(createElement(DashboardShell));
    const user = userEvent.setup();
    const input = screen.getByLabelText("Venue ID");

    await user.click(input);
    await user.click(screen.getByRole("option", { name: "aclweb.org/ACL/2026/Conference" }));

    expect(input).toHaveValue("aclweb.org/ACL/2026/Conference");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("classifies non-ARR venue IDs as commitment stage while typing", async () => {
    vi.stubGlobal("fetch", createFetchMock());

    render(createElement(DashboardShell));

    const user = userEvent.setup();
    const input = screen.getByLabelText("Venue ID");
    await user.clear(input);
    await user.type(input, "aclweb.org/ACL/2026/Conference");

    expect(screen.getByText("Commitment Stage")).toBeInTheDocument();
  });

  it("hides loaded data when the venue input no longer matches it", async () => {
    vi.stubGlobal(
      "fetch",
      createFetchMock(createResponse(dashboardFixture.viewer), createResponse(dashboardFixture))
    );
    render(createElement(DashboardShell));
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /^login$/i }));
    await user.type(screen.getByLabelText(/openreview email/i), "demo@example.com");
    await user.type(screen.getByLabelText(/password/i), "secret");
    await user.click(screen.getByRole("button", { name: /sign in to openreview/i }));
    await user.click(await screen.findByRole("button", { name: /load \/ refresh/i }));
    expect(await screen.findByRole("button", { name: "42" })).toBeInTheDocument();

    await user.type(screen.getByLabelText("Venue ID"), "-different");

    expect(screen.queryByRole("button", { name: "42" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Papers" })).not.toBeInTheDocument();
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

    await user.click(screen.getByRole("button", { name: /^login$/i }));
    await user.type(screen.getByLabelText(/openreview email/i), "demo@example.com");
    await user.type(screen.getByLabelText(/password/i), "secret");
    await user.click(screen.getByRole("button", { name: /sign in to openreview/i }));
    await user.click(await screen.findByRole("button", { name: /load \/ refresh/i }));
    await user.click(await screen.findByRole("button", { name: /^logout$/i }));

    expect(await screen.findByText(/could not sign out/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^logout$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "42" })).toBeInTheDocument();
  });

  it("omits the AC Dashboard tab for commitment stage dashboards", async () => {
    const fetchMock = createFetchMock(
      createResponse(commitmentDashboardFixture.viewer),
      createResponse(commitmentDashboardFixture)
    );

    vi.stubGlobal("fetch", fetchMock);

    render(createElement(DashboardShell));

    const user = userEvent.setup();
    await user.clear(screen.getByLabelText("Venue ID"));
    await user.type(screen.getByLabelText("Venue ID"), "aclweb.org/ACL/2026/Conference");
    await user.click(screen.getByRole("button", { name: /^login$/i }));
    await user.type(screen.getByLabelText(/openreview email/i), "demo@example.com");
    await user.type(screen.getByLabelText(/password/i), "secret");
    await user.click(screen.getByRole("button", { name: /sign in to openreview/i }));
    await user.click(await screen.findByRole("button", { name: /load \/ refresh/i }));

    expect(await screen.findByRole("tab", { name: "Papers" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "AC Dashboard" })).not.toBeInTheDocument();
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
