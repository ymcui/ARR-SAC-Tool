import { createElement } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DashboardShell } from "@/components/dashboard-shell";
import type { DashboardResponse } from "@/lib/types";

function createResponse(data: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => data
  } as Response;
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
    commentsCount: 0
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
    const fetchMock = vi.fn();
    fetchMock
      .mockResolvedValueOnce(createResponse(dashboardFixture.viewer))
      .mockResolvedValueOnce(createResponse(dashboardFixture));

    vi.stubGlobal("fetch", fetchMock);

    render(createElement(DashboardShell));

    const user = userEvent.setup();
    expect(screen.getByLabelText("Venue ID")).toHaveValue("aclweb.org/ACL/ARR/2026/March");
    expect(screen.getByText("ARR Stage")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^login$/i }));
    await user.type(screen.getByLabelText(/openreview email/i), "demo@example.com");
    await user.type(screen.getByLabelText(/password/i), "secret");
    await user.click(screen.getByRole("button", { name: /sign in to openreview/i }));

    expect(await screen.findByRole("button", { name: /^logout$/i })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /load venue/i })).toBeEnabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: /load venue/i }));

    expect(await screen.findByRole("tab", { name: "Papers" })).toBeInTheDocument();
    expect(await screen.findByText("Paper workspace")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "42" })).toBeInTheDocument();
    expect(screen.queryByText("paper42")).not.toBeInTheDocument();
    expect(screen.queryByText("Load a venue.")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/batch summary/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Loaded 1 papers for this SAC batch.")).not.toBeInTheDocument();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(JSON.parse(window.localStorage.getItem("arr-sac-dashboard.recent-venues") || "[]")).toEqual([
        "aclweb.org/ACL/ARR/2026/March"
      ]);
    });
  });

  it("offers recent valid venue IDs as soft dropdown suggestions", async () => {
    window.localStorage.setItem(
      "arr-sac-dashboard.recent-venues",
      JSON.stringify(["aclweb.org/ACL/2026/Conference", "aclweb.org/ACL/ARR/2026/March"])
    );
    vi.stubGlobal("fetch", vi.fn());

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
    vi.stubGlobal("fetch", vi.fn());

    render(createElement(DashboardShell));
    const user = userEvent.setup();
    const input = screen.getByLabelText("Venue ID");

    await user.click(input);
    await user.click(screen.getByRole("option", { name: "aclweb.org/ACL/2026/Conference" }));

    expect(input).toHaveValue("aclweb.org/ACL/2026/Conference");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("classifies non-ARR venue IDs as commitment stage while typing", async () => {
    vi.stubGlobal("fetch", vi.fn());

    render(createElement(DashboardShell));

    const user = userEvent.setup();
    const input = screen.getByLabelText("Venue ID");
    await user.clear(input);
    await user.type(input, "aclweb.org/ACL/2026/Conference");

    expect(screen.getByText("Commitment Stage")).toBeInTheDocument();
  });

  it("omits the AC Dashboard tab for commitment stage dashboards", async () => {
    const fetchMock = vi.fn();
    fetchMock
      .mockResolvedValueOnce(createResponse(commitmentDashboardFixture.viewer))
      .mockResolvedValueOnce(createResponse(commitmentDashboardFixture));

    vi.stubGlobal("fetch", fetchMock);

    render(createElement(DashboardShell));

    const user = userEvent.setup();
    await user.clear(screen.getByLabelText("Venue ID"));
    await user.type(screen.getByLabelText("Venue ID"), "aclweb.org/ACL/2026/Conference");
    await user.click(screen.getByRole("button", { name: /^login$/i }));
    await user.type(screen.getByLabelText(/openreview email/i), "demo@example.com");
    await user.type(screen.getByLabelText(/password/i), "secret");
    await user.click(screen.getByRole("button", { name: /sign in to openreview/i }));
    await user.click(await screen.findByRole("button", { name: /load venue/i }));

    expect(await screen.findByRole("tab", { name: "Papers" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "AC Dashboard" })).not.toBeInTheDocument();
    expect(screen.getByText("Commitment Stage")).toBeInTheDocument();
  });
});
