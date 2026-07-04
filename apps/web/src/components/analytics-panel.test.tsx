import { createElement } from "react";
import { render, screen } from "@testing-library/react";

import AnalyticsPanel from "@/components/analytics-panel";
import type { AnalyticsInfo, PaperRecord } from "@/lib/types";

const analyticsFixture: AnalyticsInfo = {
  overallAssessmentHistogram: [
    { label: "1.0-1.5", center: 1.25, count: 0 },
    { label: "3.0-3.5", center: 3.25, count: 2 }
  ],
  metaReviewDistribution: [
    { score: 1, count: 0 },
    { score: 3, count: 1 }
  ],
  pairedScatter: []
};

const papersFixture: PaperRecord[] = [
  {
    paperNumber: 1,
    paperId: "paper1",
    paperTitle: "A Long Paper",
    paperType: "Long",
    areaChair: "~Area_Chair1",
    completedReviews: 0,
    expectedReviews: 3,
    readyForRebuttal: false,
    authorResponseReady: false,
    acChecklistReady: false,
    resubmission: false,
    preprint: false,
    hasConfidential: false,
    issueReport: false,
    reviewerConfidence: { average: null, values: [] },
    soundnessScore: { average: null, values: [] },
    excitementScore: { average: null, values: [] },
    overallAssessment: { average: null, values: [] },
    metaReviewScore: null,
    metaReviewText: "",
    responseToMetaReview: "",
    forumUrl: "https://openreview.net/forum?id=paper1"
  },
  {
    paperNumber: 2,
    paperId: "paper2",
    paperTitle: "A Second Long Paper",
    paperType: "Long",
    areaChair: "~Area_Chair1",
    completedReviews: 2,
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
    excitementScore: { average: 3, values: [3] },
    overallAssessment: { average: 3, values: [3] },
    metaReviewScore: null,
    metaReviewText: "",
    responseToMetaReview: "",
    forumUrl: "https://openreview.net/forum?id=paper2"
  },
  {
    paperNumber: 3,
    paperId: "paper3",
    paperTitle: "A Short Paper",
    paperType: "Short",
    areaChair: "~Area_Chair2",
    completedReviews: 3,
    expectedReviews: 3,
    readyForRebuttal: true,
    authorResponseReady: false,
    acChecklistReady: false,
    resubmission: false,
    preprint: false,
    hasConfidential: false,
    issueReport: false,
    reviewerConfidence: { average: 4, values: [4] },
    soundnessScore: { average: 4, values: [4] },
    excitementScore: { average: 4, values: [4] },
    overallAssessment: { average: 4, values: [4] },
    metaReviewScore: 3,
    metaReviewText: "",
    responseToMetaReview: "",
    forumUrl: "https://openreview.net/forum?id=paper3"
  }
];

describe("AnalyticsPanel", () => {
  it("shows paper stats before secondary analytics", () => {
    render(createElement(AnalyticsPanel, { analytics: analyticsFixture, papers: papersFixture }));

    const paperStatsHeading = screen.getByRole("heading", { name: "Paper Stats" });
    const analyticsHeading = screen.getByRole("heading", { name: "Analytics" });

    expect(paperStatsHeading.compareDocumentPosition(analyticsHeading)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.getByText("Paper type mix")).toBeInTheDocument();
    expect(screen.getByText("Completed reviews per paper")).toBeInTheDocument();
    expect(screen.getByText("0 reviews: 1 paper (33%)")).toBeInTheDocument();
    expect(screen.getByText("2 (67%)")).toBeInTheDocument();
    expect(screen.getByText("1 (33%)")).toBeInTheDocument();
  });
});
