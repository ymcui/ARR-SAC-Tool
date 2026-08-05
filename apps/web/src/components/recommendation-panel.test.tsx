import { createElement } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RecommendationPanel } from "@/components/recommendation-panel";
import type { PaperRecord } from "@/lib/types";

const papersFixture: PaperRecord[] = [
  {
    paperNumber: 42,
    paperId: "paper42",
    paperTitle: "A Careful Study of Reviewer Discussion Dynamics",
    paperType: "Long",
    areaChair: "~Area_ChairB",
    completedReviews: 3,
    expectedReviews: 3,
    readyForRebuttal: true,
    authorResponseReady: true,
    acChecklistReady: true,
    resubmission: false,
    preprint: false,
    hasConfidential: false,
    issueReport: false,
    recommendationPosted: true,
    recommendation: "Possible Findings",
    recommendationConfidence: 3,
    presentationForm: "Poster",
    reviewerConfidence: { average: 4, values: [4] },
    soundnessScore: { average: 4, values: [4] },
    excitementScore: { average: 3, values: [3] },
    overallAssessment: { average: 3.7, values: [4, 3.5] },
    metaReviewScore: 4,
    metaReviewText: "",
    responseToMetaReview: "",
    forumUrl: "https://openreview.net/forum?id=commitment-42"
  },
  {
    paperNumber: 88,
    paperId: "paper88",
    paperTitle: "Flexible Presentation Planning",
    paperType: "Short",
    areaChair: "~Area_ChairA",
    completedReviews: 3,
    expectedReviews: 3,
    readyForRebuttal: true,
    authorResponseReady: true,
    acChecklistReady: true,
    resubmission: false,
    preprint: false,
    hasConfidential: false,
    issueReport: false,
    recommendationPosted: true,
    recommendation: "Accept",
    recommendationConfidence: 4,
    presentationForm: "Either",
    reviewerConfidence: { average: 3, values: [3] },
    soundnessScore: { average: 3, values: [3] },
    excitementScore: { average: 3, values: [3] },
    overallAssessment: { average: 4.2, values: [4, 4.5] },
    metaReviewScore: 3.5,
    metaReviewText: "",
    responseToMetaReview: "",
    forumUrl: "https://openreview.net/forum?id=commitment-88"
  },
  {
    paperNumber: 107,
    paperId: "paper107",
    paperTitle: "Awaiting an SAC Recommendation",
    paperType: "Long",
    areaChair: "~Area_ChairC",
    completedReviews: 3,
    expectedReviews: 3,
    readyForRebuttal: true,
    authorResponseReady: true,
    acChecklistReady: true,
    resubmission: false,
    preprint: false,
    hasConfidential: false,
    issueReport: false,
    recommendationPosted: false,
    recommendation: "",
    recommendationConfidence: null,
    presentationForm: "",
    reviewerConfidence: { average: 3, values: [3] },
    soundnessScore: { average: 3, values: [3] },
    excitementScore: { average: 3, values: [3] },
    overallAssessment: { average: null, values: [] },
    metaReviewScore: null,
    metaReviewText: "",
    responseToMetaReview: "",
    forumUrl: "https://openreview.net/forum?id=commitment-107"
  }
];

function paperOrder() {
  return screen
    .getAllByRole("link", { name: /open paper \d+ in openreview/i })
    .map((link) => Number(link.textContent));
}

describe("RecommendationPanel", () => {
  it("renders the requested SAC recommendation fields as venue-provided text", () => {
    render(createElement(RecommendationPanel, { papers: papersFixture }));

    const table = screen.getByRole("table", { name: "SAC recommendations" });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((header) => (header.textContent || "").replace(/[↕↑↓]/g, "").trim())
    ).toEqual([
      "Paper",
      "Type",
      "Meta",
      "Overall",
      "Confidence",
      "Recommendation",
      "Presentation Form"
    ]);
    expect(within(table).getByText("Possible Findings")).toBeInTheDocument();
    expect(within(table).getByText("Poster")).toBeInTheDocument();
    expect(within(table).getByText("Either")).toBeInTheDocument();
    expect(within(table).queryByText("Not posted")).not.toBeInTheDocument();
    expect(within(table).queryByText("Not specified")).not.toBeInTheDocument();
    expect(within(table).getAllByText("N/A").length).toBeGreaterThanOrEqual(4);
    expect(screen.getByRole("link", { name: "Open paper 42 in OpenReview" })).toHaveAttribute(
      "href",
      "https://openreview.net/forum?id=commitment-42"
    );
  });

  it("filters recommendation text and updates the posted summary", async () => {
    render(createElement(RecommendationPanel, { papers: papersFixture }));
    const user = userEvent.setup();
    const summary = screen.getByLabelText("Recommendation summary");

    expect(within(summary).getByText("2/3")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Search recommendations"), "possible findings");

    expect(paperOrder()).toEqual([42]);
    expect(within(summary).getByText("1/1")).toBeInTheDocument();
  });

  it("sorts numeric recommendation fields and keeps missing values last", async () => {
    render(createElement(RecommendationPanel, { papers: papersFixture }));
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Confidence" }));
    expect(paperOrder()).toEqual([88, 42, 107]);

    await user.click(screen.getByRole("button", { name: "Confidence" }));
    expect(paperOrder()).toEqual([42, 88, 107]);
  });
});
