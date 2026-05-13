"use client";

import { Fragment, useDeferredValue, useState } from "react";

import { TableBooleanIcon } from "@/components/table-boolean-icon";
import { formatCountPair, formatScore, formatScoreSummary, joinClasses } from "@/lib/format";
import type { PaperRecord, VenueStage, WithdrawnPaperRecord } from "@/lib/types";

type PapersPanelProps = {
  exportError?: string | null;
  isExporting?: boolean;
  onExport?: () => void;
  papers: PaperRecord[];
  venueStage?: VenueStage;
  withdrawnPapers: WithdrawnPaperRecord[];
};

type SortColumn =
  | "paperNumber"
  | "areaChair"
  | "paperType"
  | "reviews"
  | "readyForRebuttal"
  | "authorResponseReady"
  | "acChecklistReady"
  | "resubmission"
  | "preprint"
  | "hasConfidential"
  | "issueReport"
  | "reviewerConfidence"
  | "soundnessScore"
  | "excitementScore"
  | "metaReviewScore"
  | "overallAssessment";

type SortDirection = "asc" | "desc";

type SortDefinition = {
  column: SortColumn;
  label: string;
  defaultDirection: SortDirection;
};

const ARR_SORT_DEFINITIONS: SortDefinition[] = [
  { column: "paperNumber", label: "Paper", defaultDirection: "asc" },
  { column: "areaChair", label: "Area Chair", defaultDirection: "asc" },
  { column: "paperType", label: "Type", defaultDirection: "asc" },
  { column: "reviews", label: "Reviews", defaultDirection: "desc" },
  { column: "readyForRebuttal", label: "Ready", defaultDirection: "desc" },
  { column: "authorResponseReady", label: "Responses", defaultDirection: "desc" },
  { column: "acChecklistReady", label: "Checklist", defaultDirection: "desc" },
  { column: "metaReviewScore", label: "Meta", defaultDirection: "desc" },
  { column: "overallAssessment", label: "Overall", defaultDirection: "desc" }
];

const COMMITMENT_SORT_DEFINITIONS: SortDefinition[] = [
  { column: "paperNumber", label: "Paper", defaultDirection: "asc" },
  { column: "paperType", label: "Type", defaultDirection: "asc" },
  { column: "resubmission", label: "Resubmission", defaultDirection: "desc" },
  { column: "preprint", label: "Pre-print", defaultDirection: "desc" },
  { column: "hasConfidential", label: "Has confidential", defaultDirection: "desc" },
  { column: "issueReport", label: "Issue report", defaultDirection: "desc" },
  { column: "metaReviewScore", label: "Meta", defaultDirection: "desc" },
  { column: "overallAssessment", label: "Overall", defaultDirection: "desc" },
  { column: "soundnessScore", label: "Soundness", defaultDirection: "desc" },
  { column: "excitementScore", label: "Excitement", defaultDirection: "desc" },
  { column: "reviewerConfidence", label: "Confidence", defaultDirection: "desc" }
];

function scoreBlock(
  label: string,
  paper: PaperRecord,
  key: keyof Pick<
    PaperRecord,
    "reviewerConfidence" | "soundnessScore" | "excitementScore" | "overallAssessment"
  >
) {
  const summary = paper[key];
  return (
    <div className="score-block">
      <span className="score-label">{label}</span>
      <strong>{formatScoreSummary(summary)}</strong>
    </div>
  );
}

function metaReviewCell(score: number | null) {
  return score == null ? <TableBooleanIcon label="Meta-review" value={false} /> : formatScore(score);
}

function nextDirection(
  column: SortColumn,
  currentColumn: SortColumn,
  currentDirection: SortDirection,
  definitions: SortDefinition[]
): SortDirection {
  if (column === currentColumn) {
    return currentDirection === "asc" ? "desc" : "asc";
  }

  const definition = definitions.find((item) => item.column === column);
  return definition?.defaultDirection ?? "asc";
}

function compareNullableNumber(
  left: number | null | undefined,
  right: number | null | undefined,
  direction: SortDirection
) {
  if (left == null && right == null) {
    return 0;
  }
  if (left == null) {
    return 1;
  }
  if (right == null) {
    return -1;
  }
  return direction === "asc" ? left - right : right - left;
}

function compareText(left: string, right: string, direction: SortDirection) {
  const comparison = left.localeCompare(right, undefined, { sensitivity: "base" });
  return direction === "asc" ? comparison : -comparison;
}

function compareBoolean(left: boolean, right: boolean, direction: SortDirection) {
  const comparison = Number(left) - Number(right);
  return direction === "asc" ? comparison : -comparison;
}

function headerAriaSort(column: SortColumn, sortColumn: SortColumn, sortDirection: SortDirection) {
  if (column !== sortColumn) {
    return "none";
  }
  return sortDirection === "asc" ? "ascending" : "descending";
}

function WithdrawnPapersPanel({ withdrawnPapers }: { withdrawnPapers: WithdrawnPaperRecord[] }) {
  if (withdrawnPapers.length === 0) {
    return null;
  }

  return (
    <section className="panel withdrawn-papers-panel">
      <div className="section-header">
        <div>
          <p className="eyebrow">Inactive submissions</p>
          <h2>Withdrawn Papers</h2>
        </div>
      </div>

      <div className="table-scroll">
        <table className="data-table withdrawn-papers-table">
          <thead>
            <tr>
              <th>Paper</th>
              <th>Title</th>
              <th>Area Chair</th>
              <th>Type</th>
              <th>Status</th>
              <th>OpenReview</th>
            </tr>
          </thead>
          <tbody>
            {withdrawnPapers.map((paper) => {
              const displayTitle = (paper.paperTitle || "").trim() || `Paper ${paper.paperNumber}`;

              return (
                <tr key={paper.paperId}>
                  <td>
                    <strong>{paper.paperNumber}</strong>
                  </td>
                  <td>
                    <span className="withdrawn-paper-title">{displayTitle}</span>
                  </td>
                  <td>{paper.areaChair || "Unassigned"}</td>
                  <td>{paper.paperType || "Unspecified"}</td>
                  <td>
                    <span className="status-chip withdrawn">{paper.status || "Withdrawn"}</span>
                  </td>
                  <td>
                    <a href={paper.forumUrl} rel="noreferrer" target="_blank">
                      Open paper thread
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ExportButton({
  exportError,
  isExporting = false,
  onExport,
  papersCount
}: {
  exportError?: string | null;
  isExporting?: boolean;
  onExport?: () => void;
  papersCount: number;
}) {
  return (
    <div className="papers-export-actions">
      {exportError ? <span className="export-error">{exportError}</span> : null}
      <button
        className="primary-button"
        disabled={!onExport || isExporting || papersCount === 0}
        onClick={onExport}
        type="button"
      >
        {isExporting ? "Exporting..." : "Export XLSX"}
      </button>
    </div>
  );
}

export function PapersPanel({
  exportError,
  isExporting,
  onExport,
  papers,
  venueStage = "ARR Stage",
  withdrawnPapers
}: PapersPanelProps) {
  const [search, setSearch] = useState("");
  const [sortColumn, setSortColumn] = useState<SortColumn>("paperNumber");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [expandedPaperId, setExpandedPaperId] = useState<string | null>(null);

  const deferredSearch = useDeferredValue(search.trim().toLowerCase());
  const isCommitmentStage = venueStage === "Commitment Stage";
  const sortDefinitions = isCommitmentStage ? COMMITMENT_SORT_DEFINITIONS : ARR_SORT_DEFINITIONS;
  const activeSortColumn = sortDefinitions.some((definition) => definition.column === sortColumn)
    ? sortColumn
    : "paperNumber";
  const tableColumnCount = sortDefinitions.length;

  const filteredPapers = [...papers]
    .filter((paper) => {
      if (!deferredSearch) {
        return true;
      }

      const searchSpace = [paper.paperNumber, paper.paperId, paper.paperTitle, paper.areaChair, paper.paperType]
        .join(" ")
        .toLowerCase();

      return searchSpace.includes(deferredSearch);
    })
    .sort((left, right) => {
      switch (activeSortColumn) {
        case "paperNumber":
          return sortDirection === "asc"
            ? left.paperNumber - right.paperNumber
            : right.paperNumber - left.paperNumber;
        case "areaChair":
          return (
            compareText(left.areaChair, right.areaChair, sortDirection) ||
            left.paperNumber - right.paperNumber
          );
        case "paperType":
          return (
            compareText(left.paperType || "", right.paperType || "", sortDirection) ||
            left.paperNumber - right.paperNumber
          );
        case "reviews": {
          const leftGap = left.expectedReviews - left.completedReviews;
          const rightGap = right.expectedReviews - right.completedReviews;
          const comparison = sortDirection === "asc" ? leftGap - rightGap : rightGap - leftGap;
          return comparison || left.paperNumber - right.paperNumber;
        }
        case "readyForRebuttal":
          return (
            compareBoolean(left.readyForRebuttal, right.readyForRebuttal, sortDirection) ||
            left.paperNumber - right.paperNumber
          );
        case "authorResponseReady":
          return (
            compareBoolean(left.authorResponseReady, right.authorResponseReady, sortDirection) ||
            left.paperNumber - right.paperNumber
          );
        case "acChecklistReady":
          return (
            compareBoolean(left.acChecklistReady, right.acChecklistReady, sortDirection) ||
            left.paperNumber - right.paperNumber
          );
        case "resubmission":
          return (
            compareBoolean(left.resubmission, right.resubmission, sortDirection) ||
            left.paperNumber - right.paperNumber
          );
        case "preprint":
          return (
            compareBoolean(left.preprint, right.preprint, sortDirection) ||
            left.paperNumber - right.paperNumber
          );
        case "hasConfidential":
          return (
            compareBoolean(left.hasConfidential, right.hasConfidential, sortDirection) ||
            left.paperNumber - right.paperNumber
          );
        case "issueReport":
          return (
            compareBoolean(left.issueReport, right.issueReport, sortDirection) ||
            left.paperNumber - right.paperNumber
          );
        case "reviewerConfidence":
          return (
            compareNullableNumber(
              left.reviewerConfidence.average,
              right.reviewerConfidence.average,
              sortDirection
            ) || left.paperNumber - right.paperNumber
          );
        case "soundnessScore":
          return (
            compareNullableNumber(left.soundnessScore.average, right.soundnessScore.average, sortDirection) ||
            left.paperNumber - right.paperNumber
          );
        case "excitementScore":
          return (
            compareNullableNumber(
              left.excitementScore.average,
              right.excitementScore.average,
              sortDirection
            ) || left.paperNumber - right.paperNumber
          );
        case "metaReviewScore":
          return (
            compareNullableNumber(left.metaReviewScore, right.metaReviewScore, sortDirection) ||
            left.paperNumber - right.paperNumber
          );
        case "overallAssessment":
          return (
            compareNullableNumber(
              left.overallAssessment.average,
              right.overallAssessment.average,
              sortDirection
            ) || left.paperNumber - right.paperNumber
          );
        default:
          return left.paperNumber - right.paperNumber;
      }
    });

  const readyForRebuttalCount = filteredPapers.filter((paper) => paper.readyForRebuttal).length;
  const missingReviewsCount = filteredPapers.reduce(
    (total, paper) => total + Math.max(0, 3 - paper.completedReviews),
    0
  );

  function togglePaperDetails(paperId: string) {
    setExpandedPaperId((currentPaperId) => (currentPaperId === paperId ? null : paperId));
  }

  return (
    <>
      <section className="panel papers-panel">
      <div className="section-header papers-panel-header">
        <div>
          <p className="eyebrow">Paper workspace</p>
          <h2>Papers</h2>
        </div>
        <div className="papers-header-controls">
          {isCommitmentStage ? (
            <ExportButton
              exportError={exportError}
              isExporting={isExporting}
              onExport={onExport}
              papersCount={papers.length}
            />
          ) : (
            <div className="papers-summary-pills" aria-label="Papers summary">
              <div className="papers-summary-pill">
                <span className="papers-summary-pill-label">Ready for rebuttal</span>
                <span className="papers-summary-pill-value">
                  {readyForRebuttalCount}/{filteredPapers.length}
                </span>
              </div>
              <div className="papers-summary-pill">
                <span className="papers-summary-pill-label">Missing reviews</span>
                <span className="papers-summary-pill-value">{missingReviewsCount}</span>
              </div>
            </div>
          )}
          <div className="papers-header-search">
            <input
              aria-label="Search papers"
              onChange={(event) => setSearch(event.target.value)}
              placeholder={isCommitmentStage ? "Search paper # or type" : "Search paper #, AC, or type"}
              value={search}
            />
          </div>
        </div>
      </div>

      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              {sortDefinitions.map((definition) => {
                const isActive = definition.column === activeSortColumn;
                const indicator = !isActive ? "↕" : sortDirection === "asc" ? "↑" : "↓";

                return (
                  <th
                    aria-sort={headerAriaSort(definition.column, activeSortColumn, sortDirection)}
                    key={definition.column}
                    scope="col"
                  >
                    <button
                      className={joinClasses("table-head-button", isActive && "active")}
                      onClick={() => {
                        setSortDirection((currentDirection) =>
                          nextDirection(definition.column, activeSortColumn, currentDirection, sortDefinitions)
                        );
                        setSortColumn(definition.column);
                      }}
                      type="button"
                    >
                      <span>{definition.label}</span>
                      <span aria-hidden="true" className="sort-indicator">
                        {indicator}
                      </span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {filteredPapers.length === 0 ? (
              <tr>
                <td className="empty-cell" colSpan={tableColumnCount}>
                  No papers match the current search.
                </td>
              </tr>
            ) : null}

            {filteredPapers.map((paper) => {
              const expanded = expandedPaperId === paper.paperId;
              const displayTitle = (paper.paperTitle || "").trim() || `Paper ${paper.paperNumber}`;
              return (
                <Fragment key={paper.paperId}>
                  <tr
                    aria-expanded={expanded}
                    className={joinClasses("clickable-row", expanded && "expanded")}
                    onClick={() => togglePaperDetails(paper.paperId)}
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget) {
                        return;
                      }
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        togglePaperDetails(paper.paperId);
                      }
                    }}
                    tabIndex={0}
                  >
                    <td>
                      <button
                        aria-expanded={expanded}
                        className="row-toggle"
                        onClick={(event) => {
                          event.stopPropagation();
                          togglePaperDetails(paper.paperId);
                        }}
                        type="button"
                      >
                        <strong>{paper.paperNumber}</strong>
                      </button>
                    </td>
                    {isCommitmentStage ? (
                      <>
                        <td>{paper.paperType || "Unspecified"}</td>
                        <td>
                          <TableBooleanIcon label="Resubmission" value={paper.resubmission} />
                        </td>
                        <td>
                          <TableBooleanIcon label="Pre-print" value={paper.preprint} />
                        </td>
                        <td>
                          <TableBooleanIcon label="Has confidential" value={paper.hasConfidential} />
                        </td>
                        <td>
                          <TableBooleanIcon label="Issue report" value={paper.issueReport} />
                        </td>
                        <td>{metaReviewCell(paper.metaReviewScore)}</td>
                        <td>{formatScore(paper.overallAssessment.average)}</td>
                        <td>{formatScore(paper.soundnessScore.average)}</td>
                        <td>{formatScore(paper.excitementScore.average)}</td>
                        <td>{formatScore(paper.reviewerConfidence.average)}</td>
                      </>
                    ) : (
                      <>
                        <td>{paper.areaChair}</td>
                        <td>{paper.paperType || "Unspecified"}</td>
                        <td>{formatCountPair(paper.completedReviews, paper.expectedReviews)}</td>
                        <td>
                          <TableBooleanIcon label="Ready" value={paper.readyForRebuttal} />
                        </td>
                        <td>
                          <TableBooleanIcon label="Responses" value={paper.authorResponseReady} />
                        </td>
                        <td>
                          <TableBooleanIcon label="Checklist" value={paper.acChecklistReady} />
                        </td>
                        <td>{metaReviewCell(paper.metaReviewScore)}</td>
                        <td>{formatScoreSummary(paper.overallAssessment)}</td>
                      </>
                    )}
                  </tr>

                  {expanded ? (
                    <tr className="detail-row" key={`${paper.paperId}-detail`}>
                      <td colSpan={tableColumnCount}>
                        <div className="collapsible-shell">
                          <div className="collapsible-inner">
                            <div className="detail-panel-content paper-detail-grid">
                              <div className="paper-detail-title">
                                <span className="score-label">Paper title</span>
                                <h3>{displayTitle}</h3>
                              </div>

                              <div className="detail-stack">
                                <h3>Reviewer score breakdown</h3>
                                {scoreBlock("Confidence", paper, "reviewerConfidence")}
                                {scoreBlock("Soundness", paper, "soundnessScore")}
                                {scoreBlock("Excitement", paper, "excitementScore")}
                                {scoreBlock("Overall", paper, "overallAssessment")}
                              </div>

                              <div className="detail-stack">
                                <h3>Paper status</h3>
                                <div className="score-block">
                                  <span className="score-label">Paper ID</span>
                                  <strong className="monospace">{paper.paperId}</strong>
                                </div>
                                <div className="score-block">
                                  <span className="score-label">Meta-review</span>
                                  <strong>{formatScore(paper.metaReviewScore)}</strong>
                                </div>
                                <div className="score-block">
                                  <span className="score-label">Review readiness</span>
                                  <strong>
                                    {paper.readyForRebuttal ? "Three or more reviews" : "Still below threshold"}
                                  </strong>
                                </div>
                                <div className="score-block">
                                  <span className="score-label">OpenReview forum</span>
                                  <a href={paper.forumUrl} rel="noreferrer" target="_blank">
                                    Open paper thread
                                  </a>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      </section>
      <WithdrawnPapersPanel withdrawnPapers={withdrawnPapers} />
    </>
  );
}
