import { createElement } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

import { ACDashboardPanel } from "@/components/ac-dashboard-panel";
import type { AreaChairRecord, PaperRecord } from "@/lib/types";

let writeTextMock: ReturnType<typeof vi.fn>;

function mockClipboard() {
  writeTextMock = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: writeTextMock
    }
  });
}

const areaChairsFixture: AreaChairRecord[] = [
  {
    areaChair: "~Area_ChairReady",
    areaChairName: "Ready Chair",
    areaChairEmail: "ready@example.com",
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
    areaChairName: "Pending Chair",
    areaChairEmail: "pending@example.com",
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
  beforeEach(() => {
    mockClipboard();
  });

  it("uses icon status markers for boolean table values", () => {
    render(createElement(ACDashboardPanel, { areaChairs: areaChairsFixture, papers: papersFixture }));

    const table = screen.getByRole("table");
    const summary = screen.getByLabelText("AC dashboard summary");

    expect(screen.getByLabelText(`${areaChairsFixture.length} area chairs`)).toHaveTextContent(
      String(areaChairsFixture.length)
    );
    expect(within(summary).getByText("Missing meta-reviews")).toBeInTheDocument();
    expect(within(summary).getByText("1")).toBeInTheDocument();
    expect(within(table).getAllByRole("img")).toHaveLength(4);
    expect(within(table).getByRole("img", { name: "All papers ready: Yes" })).toBeInTheDocument();
    expect(within(table).getByRole("img", { name: "All papers ready: No" })).toBeInTheDocument();
    expect(within(table).getByRole("img", { name: "All meta-reviews ready: Yes" })).toBeInTheDocument();
    expect(within(table).getByRole("img", { name: "All meta-reviews ready: No" })).toBeInTheDocument();
    expect(within(table).queryByText("Yes")).not.toBeInTheDocument();
    expect(within(table).queryByText("No")).not.toBeInTheDocument();
  });

  it("copies all meta-reviewer emails in mail-client friendly format", async () => {
    render(createElement(ACDashboardPanel, { areaChairs: areaChairsFixture, papers: papersFixture }));
    const user = userEvent.setup();
    mockClipboard();

    const copyAllButton = screen.getByRole("button", { name: /copy emails for all 2 meta-reviewers/i });
    await user.click(copyAllButton);

    expect(writeTextMock).toHaveBeenCalledWith(
      "Ready Chair <ready@example.com>; Pending Chair <pending@example.com>"
    );
    expect(copyAllButton).toHaveTextContent("Copied 2 emails");
  });

  it("sorts review count pairs by completed reviews before expected reviews", async () => {
    const sortableAreaChairs: AreaChairRecord[] = [
      {
        ...areaChairsFixture[0],
        areaChair: "~Sort_ThreeOfFour",
        totalCompletedReviews: 3,
        totalExpectedReviews: 4
      },
      {
        ...areaChairsFixture[0],
        areaChair: "~Sort_TwoOfFive",
        totalCompletedReviews: 2,
        totalExpectedReviews: 5
      },
      {
        ...areaChairsFixture[0],
        areaChair: "~Sort_TwoOfThree",
        totalCompletedReviews: 2,
        totalExpectedReviews: 3
      }
    ];
    render(createElement(ACDashboardPanel, { areaChairs: sortableAreaChairs, papers: [] }));
    const user = userEvent.setup();

    const areaChairOrder = () => screen.getAllByText(/^~Sort_/).map((node) => node.textContent);

    await user.click(screen.getByRole("button", { name: "Reviews" }));

    expect(screen.getByRole("columnheader", { name: /^Reviews$/i })).toHaveAttribute("aria-sort", "descending");
    expect(areaChairOrder()).toEqual(["~Sort_ThreeOfFour", "~Sort_TwoOfFive", "~Sort_TwoOfThree"]);

    await user.click(screen.getByRole("button", { name: "Reviews" }));

    expect(screen.getByRole("columnheader", { name: /^Reviews$/i })).toHaveAttribute("aria-sort", "ascending");
    expect(areaChairOrder()).toEqual(["~Sort_TwoOfThree", "~Sort_TwoOfFive", "~Sort_ThreeOfFour"]);
  });

  it("reveals assigned papers and their stats when clicking a table row", async () => {
    render(createElement(ACDashboardPanel, { areaChairs: areaChairsFixture, papers: papersFixture }));
    const user = userEvent.setup();
    mockClipboard();

    expect(screen.queryByText("A Paper Missing Reviews")).not.toBeInTheDocument();

    await user.click(screen.getByText("~Area_ChairPending"));

    expect(await screen.findByText("A Paper Missing Reviews")).toBeInTheDocument();
    expect(screen.getByText("A Ready Paper Awaiting Meta-review")).toBeInTheDocument();
    expect(screen.getByText("1 / 3")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Meta-review: No" })).toBeInTheDocument();
    expect(screen.queryByText("Pending")).not.toBeInTheDocument();
    expect(screen.getByText("3.5")).toBeInTheDocument();
    const copyEmailButton = screen.getByRole("button", {
      name: "Copy email for Pending Chair <pending@example.com>"
    });
    await user.click(copyEmailButton);
    expect(writeTextMock).toHaveBeenLastCalledWith("Pending Chair <pending@example.com>");
    expect(copyEmailButton).toHaveTextContent("Copied! Pending Chair <pending@example.com>");
    expect(screen.queryByText("A Fully Reviewed Paper")).not.toBeInTheDocument();
  });
});
