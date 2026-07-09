import { createElement } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AlertsPanel } from "@/components/alerts-panel";
import type { AlertGroup, AreaChairRecord, PaperRecord } from "@/lib/types";

const papersFixture: PaperRecord[] = [
  {
    paperNumber: 42,
    paperId: "paper42",
    paperTitle: "A Careful Study of Reviewer Discussion Dynamics",
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
    reviewerConfidence: { average: null, values: [] },
    soundnessScore: { average: null, values: [] },
    excitementScore: { average: null, values: [] },
    overallAssessment: { average: 3.5, values: [3, 4] },
    metaReviewScore: null,
    metaReviewText: "",
    responseToMetaReview: "",
    forumUrl: "https://openreview.net/forum?id=paper42"
  },
  {
    paperNumber: 88,
    paperId: "paper88",
    paperTitle: "Improving Meta-review Readiness Signals",
    paperType: "Short",
    areaChair: "~Area_Chair1",
    completedReviews: 3,
    expectedReviews: 3,
    readyForRebuttal: true,
    authorResponseReady: false,
    acChecklistReady: false,
    resubmission: false,
    preprint: false,
    hasConfidential: false,
    issueReport: false,
    reviewerConfidence: { average: null, values: [] },
    soundnessScore: { average: null, values: [] },
    excitementScore: { average: null, values: [] },
    overallAssessment: { average: 4, values: [4] },
    metaReviewScore: null,
    metaReviewText: "",
    responseToMetaReview: "",
    forumUrl: "https://openreview.net/forum?id=paper88"
  }
];

const areaChairsFixture: AreaChairRecord[] = [
  {
    areaChair: "~Area_Chair1",
    areaChairName: "Area Chair One",
    areaChairEmail: "chair1@example.com",
    totalCompletedReviews: 2,
    totalExpectedReviews: 3,
    papersReady: 0,
    numPapers: 1,
    allReviewsReady: false,
    metaReviewsDone: 0,
    acChecklistDone: 0,
    allMetaReviewsReady: false
  }
];

const alertsFixture: AlertGroup[] = [
  {
    paperNumber: 88,
    paperId: "paper88",
    paperTitle: "Improving Meta-review Readiness Signals",
    forumUrl: "https://openreview.net/forum?id=paper88",
    items: [
      {
        noteId: "delay88",
        paperNumber: 88,
        paperId: "paper88",
        type: "Delay Notification",
        role: "Reviewer",
        signerLabel: "Reviewer Late",
        date: "2026-07-04",
        content: "**Notification:** Review will arrive tomorrow.",
        link: "https://openreview.net/forum?id=paper88&noteId=delay88",
        children: []
      }
    ]
  },
  {
    paperNumber: 42,
    paperId: "paper42",
    paperTitle: "A Careful Study of Reviewer Discussion Dynamics",
    forumUrl: "https://openreview.net/forum?id=paper42",
    items: [
      {
        noteId: "emergency1",
        paperNumber: 42,
        paperId: "paper42",
        type: "Emergency Declaration",
        role: "Reviewer",
        signerLabel: "Reviewer F6TN",
        date: "2026-07-03",
        content: "**Declaration:** Medical\n\n**Explanation:** I need an emergency replacement.",
        link: "https://openreview.net/forum?id=paper42&noteId=emergency1",
        children: [
          {
            noteId: "emergency-comment",
            paperNumber: 42,
            paperId: "paper42",
            type: "Official Comment",
            role: "Area Chair",
            signerLabel: "Area Chair 1",
            date: "2026-07-03",
            content: "We are finding a replacement reviewer.",
            link: "https://openreview.net/forum?id=paper42&noteId=emergency-comment",
            children: []
          }
        ]
      },
      {
        noteId: "delay1",
        paperNumber: 42,
        paperId: "paper42",
        type: "Delay Notification",
        role: "Reviewer",
        signerLabel: "Reviewer REii",
        date: "2026-07-03",
        content: "**Notification:** I need four more days.",
        link: "https://openreview.net/forum?id=paper42&noteId=delay1",
        children: []
      }
    ]
  }
];

function renderAlertsPanel(alerts: AlertGroup[] = alertsFixture, papers: PaperRecord[] = papersFixture) {
  render(
    createElement(AlertsPanel, {
      alerts,
      areaChairs: areaChairsFixture,
      papers
    })
  );
}

function getAlertPaperOrder() {
  return screen
    .getAllByRole("button")
    .filter((button) => /^\d+$/.test((button.textContent || "").trim()))
    .map((button) => Number(button.textContent));
}

describe("AlertsPanel", () => {
  it("renders an empty state when there are no alerts", () => {
    renderAlertsPanel([]);
    expect(screen.getByText(/no review alerts need attention/i)).toBeInTheDocument();
  });

  it("renders a compact alert table and expands alert details", async () => {
    renderAlertsPanel();
    const user = userEvent.setup();
    const row = screen.getByRole("row", {
      name: /42 ~area_chair1 long 2 \/ 3 ready: no 1 1 3\.5 \(3\.0 \/ 4\.0\)/i
    });
    const summary = screen.getByLabelText("Alerts summary");
    const dataRows = screen.getAllByRole("row").slice(1);

    expect(within(summary).getByText("Ready")).toBeInTheDocument();
    expect(within(summary).getByText("1/2")).toBeInTheDocument();
    expect(within(summary).getByText("Emergency")).toBeInTheDocument();
    expect(within(summary).getByText("Delay")).toBeInTheDocument();
    expect(within(summary).getByText("1")).toBeInTheDocument();
    expect(within(summary).getByText("2")).toBeInTheDocument();
    expect(within(dataRows[0]).getByRole("button", { name: "42" })).toBeInTheDocument();
    expect(within(dataRows[1]).getByRole("button", { name: "88" })).toBeInTheDocument();
    expect(row).toHaveAttribute("aria-expanded", "false");
    expect(within(row).getByRole("button", { name: "42" })).toHaveAttribute("aria-expanded", "false");
    expect(within(row).getByText("Long")).toBeInTheDocument();
    expect(within(row).getByText("2 / 3")).toBeInTheDocument();
    expect(within(row).getByRole("img", { name: "Ready: No" })).toBeInTheDocument();
    expect(within(dataRows[1]).getByRole("img", { name: "Ready: Yes" })).toBeInTheDocument();
    expect(within(row).getByText("~Area_Chair1")).toBeInTheDocument();
    expect(within(row).getByText("3.5 (3.0 / 4.0)")).toBeInTheDocument();
    expect(screen.queryByText(/emergency replacement/i)).not.toBeInTheDocument();

    await user.click(row);

    expect(row).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Medical")).toBeInTheDocument();
    expect(screen.getByText(/emergency replacement/i)).toBeInTheDocument();
    expect(screen.getByText(/finding a replacement reviewer/i)).toBeInTheDocument();
    expect(screen.getByText(/four more days/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open forum" })).toBeInTheDocument();
  });

  it("sorts alert rows through clickable headers", async () => {
    renderAlertsPanel();
    const user = userEvent.setup();

    expect(screen.getByRole("columnheader", { name: /ready/i })).toHaveAttribute("aria-sort", "ascending");
    expect(within(screen.getAllByRole("row")[1]).getByRole("button", { name: "42" })).toBeInTheDocument();

    await user.click(within(screen.getByRole("columnheader", { name: /paper/i })).getByRole("button"));
    expect(screen.getByRole("columnheader", { name: /paper/i })).toHaveAttribute("aria-sort", "ascending");
    expect(within(screen.getAllByRole("row")[1]).getByRole("button", { name: "42" })).toBeInTheDocument();

    await user.click(within(screen.getByRole("columnheader", { name: /paper/i })).getByRole("button"));
    expect(screen.getByRole("columnheader", { name: /paper/i })).toHaveAttribute("aria-sort", "descending");
    expect(within(screen.getAllByRole("row")[1]).getByRole("button", { name: "88" })).toBeInTheDocument();

    await user.click(within(screen.getByRole("columnheader", { name: /reviews/i })).getByRole("button"));
    expect(screen.getByRole("columnheader", { name: /reviews/i })).toHaveAttribute("aria-sort", "descending");
    expect(within(screen.getAllByRole("row")[1]).getByRole("button", { name: "42" })).toBeInTheDocument();

    await user.click(within(screen.getByRole("columnheader", { name: /reviews/i })).getByRole("button"));
    expect(screen.getByRole("columnheader", { name: /reviews/i })).toHaveAttribute("aria-sort", "ascending");
    expect(within(screen.getAllByRole("row")[1]).getByRole("button", { name: "88" })).toBeInTheDocument();

    await user.click(within(screen.getByRole("columnheader", { name: /emergency/i })).getByRole("button"));
    expect(screen.getByRole("columnheader", { name: /emergency/i })).toHaveAttribute("aria-sort", "descending");
    expect(within(screen.getAllByRole("row")[1]).getByRole("button", { name: "42" })).toBeInTheDocument();

    await user.click(within(screen.getByRole("columnheader", { name: /overall/i })).getByRole("button"));
    expect(screen.getByRole("columnheader", { name: /overall/i })).toHaveAttribute("aria-sort", "descending");
    expect(within(screen.getAllByRole("row")[1]).getByRole("button", { name: "88" })).toBeInTheDocument();
  });

  it("sorts alert review counts by finished reviews before total assigned reviews", async () => {
    const reviewSortPapers: PaperRecord[] = [
      ...papersFixture,
      {
        ...papersFixture[1],
        paperNumber: 121,
        paperId: "paper121",
        paperTitle: "A Paper With Five Assigned Reviews",
        completedReviews: 3,
        expectedReviews: 5,
        readyForRebuttal: false,
        forumUrl: "https://openreview.net/forum?id=paper121"
      }
    ];
    const reviewSortAlerts: AlertGroup[] = [
      ...alertsFixture,
      {
        paperNumber: 121,
        paperId: "paper121",
        paperTitle: "A Paper With Five Assigned Reviews",
        forumUrl: "https://openreview.net/forum?id=paper121",
        items: [
          {
            noteId: "delay121",
            paperNumber: 121,
            paperId: "paper121",
            type: "Delay Notification",
            role: "Reviewer",
            signerLabel: "Reviewer Five",
            date: "2026-07-04",
            content: "**Notification:** Review will arrive soon.",
            link: "https://openreview.net/forum?id=paper121&noteId=delay121",
            children: []
          }
        ]
      }
    ];
    renderAlertsPanel(reviewSortAlerts, reviewSortPapers);
    const user = userEvent.setup();

    await user.click(within(screen.getByRole("columnheader", { name: /reviews/i })).getByRole("button"));
    expect(getAlertPaperOrder()).toEqual([42, 88, 121]);

    await user.click(within(screen.getByRole("columnheader", { name: /reviews/i })).getByRole("button"));
    expect(getAlertPaperOrder()).toEqual([121, 88, 42]);
  });

  it("filters table rows by alert type", async () => {
    renderAlertsPanel();
    const user = userEvent.setup();

    await user.selectOptions(screen.getByLabelText("Type"), "Delay Notification");
    expect(within(screen.getByLabelText("Alerts summary")).getByText("1")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Alerts summary")).getByText("2")).toBeInTheDocument();
    const row = screen.getByRole("row", {
      name: /42 ~area_chair1 long 2 \/ 3 ready: no 0 1 3\.5 \(3\.0 \/ 4\.0\)/i
    });

    await user.click(row);

    expect(screen.getByText(/four more days/i)).toBeInTheDocument();
    expect(screen.queryByText(/emergency replacement/i)).not.toBeInTheDocument();
  });
});
