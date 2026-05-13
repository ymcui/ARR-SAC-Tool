import { createElement } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

import { PapersPanel } from "@/components/papers-panel";
import type { PaperRecord, VenueStage, WithdrawnPaperRecord } from "@/lib/types";

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
    resubmission: true,
    preprint: false,
    hasConfidential: true,
    issueReport: false,
    reviewerConfidence: { average: 4, values: [4, 4, 4] },
    soundnessScore: { average: 3.5, values: [3, 4, 3.5] },
    excitementScore: { average: 3.5, values: [3, 4, 3.5] },
    overallAssessment: { average: 4, values: [4, 4, 4] },
    metaReviewScore: 4,
    metaReviewText: "",
    responseToMetaReview: "",
    forumUrl: "https://openreview.net/forum?id=paper42"
  },
  {
    paperNumber: 88,
    paperId: "paper88",
    paperTitle: "Improving Meta-review Readiness Signals",
    paperType: "Long",
    areaChair: "~Area_ChairA",
    completedReviews: 2,
    expectedReviews: 3,
    readyForRebuttal: false,
    authorResponseReady: false,
    acChecklistReady: true,
    resubmission: false,
    preprint: true,
    hasConfidential: false,
    issueReport: true,
    reviewerConfidence: { average: 3, values: [3, 3] },
    soundnessScore: { average: 3, values: [3, 3] },
    excitementScore: { average: 2.5, values: [2.5, 2.5] },
    overallAssessment: { average: 3.2, values: [3, 3.4] },
    metaReviewScore: 2.2,
    metaReviewText: "",
    responseToMetaReview: "",
    forumUrl: "https://openreview.net/forum?id=paper88"
  },
  {
    paperNumber: 107,
    paperId: "paper107",
    paperTitle: "Compact Methods for Review Calibration",
    paperType: "Short",
    areaChair: "~Area_ChairC",
    completedReviews: 1,
    expectedReviews: 3,
    readyForRebuttal: false,
    authorResponseReady: false,
    acChecklistReady: false,
    resubmission: false,
    preprint: false,
    hasConfidential: false,
    issueReport: false,
    reviewerConfidence: { average: 2, values: [2] },
    soundnessScore: { average: 2, values: [2] },
    excitementScore: { average: 2, values: [2] },
    overallAssessment: { average: null, values: [] },
    metaReviewScore: null,
    metaReviewText: "",
    responseToMetaReview: "",
    forumUrl: "https://openreview.net/forum?id=paper107"
  }
];

const withdrawnPapersFixture: WithdrawnPaperRecord[] = [
  {
    paperNumber: 64,
    paperId: "paper64",
    paperTitle: "Withdrawn Work on Robust Review Signals",
    paperType: "Long",
    areaChair: "~Area_ChairWithdrawn",
    status: "ACL ARR 2026 March Withdrawn",
    forumUrl: "https://openreview.net/forum?id=paper64"
  }
];

function renderPapersPanel(
  withdrawnPapers: WithdrawnPaperRecord[] = [],
  venueStage: VenueStage = "ARR Stage",
  onExport?: () => void
) {
  return render(createElement(PapersPanel, { onExport, papers: papersFixture, venueStage, withdrawnPapers }));
}

function getPaperOrder() {
  return screen
    .getAllByRole("button")
    .filter((button) => /^\d+$/.test((button.textContent || "").trim()))
    .map((button) => Number(button.textContent));
}

describe("PapersPanel", () => {
  it("uses a simplified control bar and reveals the paper id only in the expanded row", async () => {
    renderPapersPanel();
    const user = userEvent.setup();

    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
    expect(screen.getByPlaceholderText("Search paper #, AC, or type")).toBeInTheDocument();
    expect(screen.queryByText("paper107")).not.toBeInTheDocument();

    await user.type(screen.getByLabelText(/search papers/i), "paper107");

    expect(screen.getByRole("button", { name: "107" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "42" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "107" }));

    expect(screen.getByText("Compact Methods for Review Calibration")).toBeInTheDocument();
    expect(await screen.findByText("Reviewer score breakdown")).toBeInTheDocument();
    expect(screen.getByText("paper107")).toBeInTheDocument();
    expect(screen.getByText("Open paper thread")).toBeInTheDocument();
  });

  it("sorts through clickable headers and keeps missing meta/overall values at the end", async () => {
    renderPapersPanel();
    const user = userEvent.setup();

    expect(getPaperOrder()).toEqual([42, 88, 107]);
    expect(screen.getByRole("columnheader", { name: /paper/i })).toHaveAttribute("aria-sort", "ascending");

    await user.click(screen.getByRole("button", { name: "Paper" }));
    expect(getPaperOrder()).toEqual([107, 88, 42]);
    expect(screen.getByRole("columnheader", { name: /paper/i })).toHaveAttribute("aria-sort", "descending");

    await user.click(screen.getByRole("button", { name: "Ready" }));
    expect(getPaperOrder()).toEqual([42, 88, 107]);
    expect(screen.getByRole("columnheader", { name: /ready/i })).toHaveAttribute("aria-sort", "descending");

    await user.click(screen.getByRole("button", { name: "Ready" }));
    expect(getPaperOrder()).toEqual([88, 107, 42]);
    expect(screen.getByRole("columnheader", { name: /ready/i })).toHaveAttribute("aria-sort", "ascending");

    await user.click(screen.getByRole("button", { name: "Meta" }));
    expect(getPaperOrder()).toEqual([42, 88, 107]);

    await user.click(screen.getByRole("button", { name: "Overall" }));
    expect(getPaperOrder()).toEqual([42, 88, 107]);
  });

  it("renders compact icon status markers in the table", () => {
    renderPapersPanel();

    const table = screen.getByRole("table");
    const statusIcons = within(table).getAllByRole("img");

    expect(statusIcons).toHaveLength(10);
    expect(within(table).getByRole("img", { name: "Ready: Yes" })).toBeInTheDocument();
    expect(within(table).getAllByRole("img", { name: "Ready: No" })).toHaveLength(2);
    expect(within(table).getAllByRole("img", { name: "Responses: No" })).toHaveLength(2);
    expect(within(table).getByRole("img", { name: "Meta-review: No" })).toBeInTheDocument();
    expect(within(table).queryByText("YES")).not.toBeInTheDocument();
    expect(within(table).queryByText("NO")).not.toBeInTheDocument();
  });

  it("uses commitment-stage columns without changing the ARR table", () => {
    renderPapersPanel([], "Commitment Stage");

    expect(screen.queryByRole("columnheader", { name: /area chair/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: /^reviews/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: /^ready/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: /^responses/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: /^checklist/i })).not.toBeInTheDocument();

    expect(screen.getByRole("columnheader", { name: /resubmission/i })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /pre-print/i })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /has confidential/i })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /issue report/i })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: /reviewer confidence/i })).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /^confidence/i })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /soundness/i })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /excitement/i })).toBeInTheDocument();
    expect(
      screen
        .getAllByRole("columnheader")
        .map((header) => (header.textContent || "").replace(/[↕↑↓]/g, "").trim())
    ).toEqual([
      "Paper",
      "Type",
      "Resubmission",
      "Pre-print",
      "Has confidential",
      "Issue report",
      "Meta",
      "Overall",
      "Soundness",
      "Excitement",
      "Confidence",
    ]);
    expect(screen.getAllByText("4.0").length).toBeGreaterThan(0);
    expect(screen.queryByText("4.0 (4.0 / 4.0 / 4.0)")).not.toBeInTheDocument();
  });

  it("reveals paper details when clicking any table row cell", async () => {
    renderPapersPanel();
    const user = userEvent.setup();

    await user.click(screen.getByText("~Area_ChairA"));

    expect(await screen.findByText("Reviewer score breakdown")).toBeInTheDocument();
    expect(screen.getByText("paper88")).toBeInTheDocument();
  });

  it("shows scholar-style summary pills and updates them with the filtered view", async () => {
    renderPapersPanel();
    const user = userEvent.setup();

    expect(screen.getByText("Ready for rebuttal")).toBeInTheDocument();
    expect(screen.getByText("1/3")).toBeInTheDocument();
    expect(screen.getByText("Missing reviews")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();

    await user.type(screen.getByLabelText(/search papers/i), "42");

    expect(screen.getByText("1/1")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("moves the commitment export action into the paper header", async () => {
    const onExport = vi.fn();
    renderPapersPanel([], "Commitment Stage", onExport);
    const user = userEvent.setup();

    expect(screen.queryByText("Export Papers")).not.toBeInTheDocument();
    expect(screen.queryByText("Ready for rebuttal")).not.toBeInTheDocument();
    expect(screen.queryByText("Missing reviews")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /export xlsx/i }));

    expect(onExport).toHaveBeenCalledTimes(1);
  });

  it("shows withdrawn papers in a separate panel below the active workspace", () => {
    renderPapersPanel(withdrawnPapersFixture);

    expect(screen.getByText("Withdrawn Papers")).toBeInTheDocument();
    expect(screen.getByText("Withdrawn Work on Robust Review Signals")).toBeInTheDocument();
    expect(screen.getByText("~Area_ChairWithdrawn")).toBeInTheDocument();
    expect(screen.getByText("ACL ARR 2026 March Withdrawn")).toBeInTheDocument();
  });
});
