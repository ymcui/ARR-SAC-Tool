import { createElement } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ACDashboardPanel } from "@/components/ac-dashboard-panel";
import type { AreaChairRecord, PaperRecord } from "@/lib/types";

const areaChairsFixture: AreaChairRecord[] = [
  {
    areaChair: "~Area_ChairReady",
    totalCompletedReviews: 6,
    totalExpectedReviews: 6,
    papersReady: 2,
    numPapers: 2,
    allReviewsReady: true,
    metaReviewsDone: 2,
    acChecklistDone: 2,
    allMetaReviewsReady: true
  },
  {
    areaChair: "~Area_ChairPending",
    totalCompletedReviews: 4,
    totalExpectedReviews: 6,
    papersReady: 1,
    numPapers: 2,
    allReviewsReady: false,
    metaReviewsDone: 1,
    acChecklistDone: 1,
    allMetaReviewsReady: false
  }
];

const papersFixture: PaperRecord[] = [
  {
    paperNumber: 101,
    paperId: "paper101",
    paperTitle: "A Fully Reviewed Paper",
    paperType: "Long",
    areaChair: "~Area_ChairReady",
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
    soundnessScore: { average: 4, values: [4, 4, 4] },
    excitementScore: { average: 4, values: [4, 4, 4] },
    overallAssessment: { average: 4, values: [4, 4, 4] },
    metaReviewScore: 4,
    metaReviewText: "",
    responseToMetaReview: "",
    forumUrl: "https://openreview.net/forum?id=paper101"
  },
  {
    paperNumber: 201,
    paperId: "paper201",
    paperTitle: "A Paper Missing Reviews",
    paperType: "Long",
    areaChair: "~Area_ChairPending",
    completedReviews: 1,
    expectedReviews: 3,
    readyForRebuttal: false,
    authorResponseReady: false,
    acChecklistReady: false,
    resubmission: false,
    preprint: false,
    hasConfidential: false,
    issueReport: false,
    reviewerConfidence: { average: 3, values: [3] },
    soundnessScore: { average: 3, values: [3] },
    excitementScore: { average: 2, values: [2] },
    overallAssessment: { average: 2.5, values: [2.5] },
    metaReviewScore: null,
    metaReviewText: "",
    responseToMetaReview: "",
    forumUrl: "https://openreview.net/forum?id=paper201"
  },
  {
    paperNumber: 202,
    paperId: "paper202",
    paperTitle: "A Ready Paper Awaiting Meta-review",
    paperType: "Short",
    areaChair: "~Area_ChairPending",
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
    overallAssessment: { average: 3.7, values: [3.5, 3.8, 3.8] },
    metaReviewScore: 3.5,
    metaReviewText: "",
    responseToMetaReview: "",
    forumUrl: "https://openreview.net/forum?id=paper202"
  }
];

describe("ACDashboardPanel", () => {
  it("uses icon status markers for boolean table values", () => {
    render(createElement(ACDashboardPanel, { areaChairs: areaChairsFixture, papers: papersFixture }));

    const table = screen.getByRole("table");

    expect(within(table).getAllByRole("img")).toHaveLength(4);
    expect(within(table).getByRole("img", { name: "All papers ready: Yes" })).toBeInTheDocument();
    expect(within(table).getByRole("img", { name: "All papers ready: No" })).toBeInTheDocument();
    expect(within(table).getByRole("img", { name: "All meta-reviews ready: Yes" })).toBeInTheDocument();
    expect(within(table).getByRole("img", { name: "All meta-reviews ready: No" })).toBeInTheDocument();
    expect(within(table).queryByText("Yes")).not.toBeInTheDocument();
    expect(within(table).queryByText("No")).not.toBeInTheDocument();
  });

  it("reveals assigned papers and their stats when clicking a table row", async () => {
    render(createElement(ACDashboardPanel, { areaChairs: areaChairsFixture, papers: papersFixture }));
    const user = userEvent.setup();

    expect(screen.queryByText("A Paper Missing Reviews")).not.toBeInTheDocument();

    await user.click(screen.getByText("~Area_ChairPending"));

    expect(await screen.findByText("A Paper Missing Reviews")).toBeInTheDocument();
    expect(screen.getByText("A Ready Paper Awaiting Meta-review")).toBeInTheDocument();
    expect(screen.getByText("1 / 3")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.getByText("3.5")).toBeInTheDocument();
    expect(screen.queryByText("A Fully Reviewed Paper")).not.toBeInTheDocument();
  });
});
