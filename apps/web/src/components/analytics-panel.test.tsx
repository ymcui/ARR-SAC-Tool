import { createElement } from "react";
import { render, screen, within } from "@testing-library/react";

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
    const scoreDistributionHeading = screen.getByText("Overall and reviewer score distributions");
    const individualOverallHeading = screen.getByText("Individual overall scores");
    const scoreStatisticsHeading = screen.getByRole("heading", { name: "Score statistics" });
    const metaReviewHeading = screen.getByText("Meta-review and confidence score distribution");
    const scatterHeading = screen.getByText("Meta-review score vs overall assessment");

    expect(scoreDistributionHeading).toBeInTheDocument();
    expect(individualOverallHeading).toBeInTheDocument();
    expect(scoreStatisticsHeading.closest(".score-statistics-surface")).toBeInTheDocument();
    expect(scoreStatisticsHeading.compareDocumentPosition(scoreDistributionHeading)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(scoreDistributionHeading.compareDocumentPosition(individualOverallHeading)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(individualOverallHeading.compareDocumentPosition(metaReviewHeading)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(metaReviewHeading.compareDocumentPosition(scatterHeading)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(within(screen.getByLabelText("Score series")).getByText("Overall")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Score series")).getByText("Excitement")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Score series")).getByText("Soundness")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Score series")).getByText("Confidence")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Individual overall score series")).getByText("Reviews")).toBeInTheDocument();
    expect(screen.queryByText("At a glance")).not.toBeInTheDocument();
    expect(screen.queryByText(/Calculated from each paper/)).not.toBeInTheDocument();
    expect(metaReviewHeading).toBeInTheDocument();
    expect(within(screen.getByLabelText("Meta-review series")).getByText("Meta-review")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Meta-review series")).queryByText("Confidence")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Paired score series")).not.toBeInTheDocument();
    expect(screen.getByText("0 reviews: 1 paper (33%)")).toBeInTheDocument();
    expect(screen.getByText("2 (67%)")).toBeInTheDocument();
    expect(screen.getByText("1 (33%)")).toBeInTheDocument();
  });

  it("shows min, max, average, and median for the four reviewer score series", () => {
    render(createElement(AnalyticsPanel, { analytics: analyticsFixture, papers: papersFixture }));

    const overallTable = screen.getByRole("table", { name: "Overall and excitement score statistics" });
    const reviewerTable = screen.getByRole("table", { name: "Soundness and confidence score statistics" });
    const overallRow = within(overallTable).getByRole("row", { name: /Overall/ });
    const excitementRow = within(overallTable).getByRole("row", { name: /Excitement/ });
    const soundnessRow = within(reviewerTable).getByRole("row", { name: /Soundness/ });
    const confidenceRow = within(reviewerTable).getByRole("row", { name: /Confidence/ });

    expect(within(overallTable).getByRole("columnheader", { name: "Min" })).toBeInTheDocument();
    expect(within(overallTable).getByRole("columnheader", { name: "Max" })).toBeInTheDocument();
    expect(within(overallTable).getByRole("columnheader", { name: "Average" })).toBeInTheDocument();
    expect(within(overallTable).getByRole("columnheader", { name: "Median" })).toBeInTheDocument();
    expect(within(overallRow).getAllByRole("cell").map((cell) => cell.textContent)).toEqual([
      "3.00",
      "4.00",
      "3.50",
      "3.50"
    ]);
    expect(within(excitementRow).getAllByRole("cell").map((cell) => cell.textContent)).toEqual([
      "3.00",
      "4.00",
      "3.50",
      "3.50"
    ]);
    expect(within(soundnessRow).getAllByRole("cell").map((cell) => cell.textContent)).toEqual([
      "3.00",
      "4.00",
      "3.50",
      "3.50"
    ]);
    expect(within(confidenceRow).getAllByRole("cell").map((cell) => cell.textContent)).toEqual([
      "3.00",
      "4.00",
      "3.50",
      "3.50"
    ]);
  });

  it("shows unavailable statistics when a score series has no values", () => {
    render(createElement(AnalyticsPanel, { analytics: analyticsFixture, papers: [papersFixture[0]] }));

    const overallTable = screen.getByRole("table", { name: "Overall and excitement score statistics" });
    const overallRow = within(overallTable).getByRole("row", { name: /Overall/ });

    expect(within(overallRow).getAllByRole("cell").map((cell) => cell.textContent)).toEqual([
      "—",
      "—",
      "—",
      "—"
    ]);
  });

  it("shows meta-review confidence only when meta-review confidence scores are available", () => {
    const papersWithMetaReviewConfidence = papersFixture.map((paper) =>
      paper.paperNumber === 3 ? { ...paper, metaReviewConfidence: { average: 4, values: [4] } } : paper
    );

    render(createElement(AnalyticsPanel, { analytics: analyticsFixture, papers: papersWithMetaReviewConfidence }));

    expect(within(screen.getByLabelText("Meta-review series")).getByText("Confidence")).toBeInTheDocument();
  });

  it("shows an empty state and hides the legend when no meta-review scores are available", () => {
    const analyticsWithoutMetaReviews: AnalyticsInfo = {
      ...analyticsFixture,
      metaReviewDistribution: analyticsFixture.metaReviewDistribution.map((point) => ({ ...point, count: 0 }))
    };

    render(createElement(AnalyticsPanel, { analytics: analyticsWithoutMetaReviews, papers: papersFixture }));

    expect(screen.getByText("No meta-review scores yet.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Meta-review series")).not.toBeInTheDocument();
  });

  it("shows the paired score legend only when paired score data is available", () => {
    const analyticsWithPairedScores: AnalyticsInfo = {
      ...analyticsFixture,
      pairedScatter: [
        {
          paperNumber: 3,
          paperLabel: "Paper 3",
          areaChair: "~Area_Chair2",
          overallAssessment: 4,
          metaReviewScore: 3
        }
      ]
    };

    render(createElement(AnalyticsPanel, { analytics: analyticsWithPairedScores, papers: papersFixture }));

    expect(within(screen.getByLabelText("Paired score series")).getByText("Paired scores")).toBeInTheDocument();
  });
});
