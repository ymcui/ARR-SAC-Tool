"use client";

import { Fragment, useMemo, useState } from "react";

import { TableBooleanIcon } from "@/components/table-boolean-icon";
import { formatCountPair, formatScore, formatScoreSummary, joinClasses } from "@/lib/format";
import type { AreaChairRecord, PaperRecord } from "@/lib/types";

type ACDashboardPanelProps = {
  areaChairs: AreaChairRecord[];
  papers: PaperRecord[];
};

type SortColumn =
  | "areaChair"
  | "reviews"
  | "papersReady"
  | "metaReviews"
  | "checklist"
  | "allReviewsReady"
  | "allMetaReviewsReady";

type SortDirection = "asc" | "desc";

type SortDefinition = {
  column: SortColumn;
  label: string;
  defaultDirection: SortDirection;
};

const AC_SORT_DEFINITIONS: SortDefinition[] = [
  { column: "areaChair", label: "Area Chair", defaultDirection: "asc" },
  { column: "reviews", label: "Reviews", defaultDirection: "desc" },
  { column: "papersReady", label: "Papers ready", defaultDirection: "desc" },
  { column: "metaReviews", label: "Meta-reviews", defaultDirection: "desc" },
  { column: "checklist", label: "Checklist", defaultDirection: "desc" },
  { column: "allReviewsReady", label: "All papers ready", defaultDirection: "desc" },
  { column: "allMetaReviewsReady", label: "All meta-reviews ready", defaultDirection: "desc" }
];

function metaReviewCell(score: number | null) {
  return score == null ? <TableBooleanIcon label="Meta-review" value={false} /> : formatScore(score);
}

function nextDirection(
  column: SortColumn,
  currentColumn: SortColumn,
  currentDirection: SortDirection
): SortDirection {
  if (column === currentColumn) {
    return currentDirection === "asc" ? "desc" : "asc";
  }

  const definition = AC_SORT_DEFINITIONS.find((item) => item.column === column);
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

function compareCountPair(
  leftCompleted: number,
  leftExpected: number,
  rightCompleted: number,
  rightExpected: number,
  direction: SortDirection
) {
  return (
    compareNullableNumber(leftCompleted, rightCompleted, direction) ||
    compareNullableNumber(leftExpected, rightExpected, direction)
  );
}

function headerAriaSort(column: SortColumn, sortColumn: SortColumn, sortDirection: SortDirection) {
  if (column !== sortColumn) {
    return "none";
  }
  return sortDirection === "asc" ? "ascending" : "descending";
}

function profileIdDisplayName(profileId: string) {
  const normalized = profileId.replace(/^~/, "").replace(/\d+$/, "").replaceAll("_", " ").trim();
  return normalized || profileId;
}

function formatRecipient(record: AreaChairRecord) {
  const email = record.areaChairEmail.trim();
  if (!email) {
    return "";
  }

  const name = (record.areaChairName || profileIdDisplayName(record.areaChair)).trim();
  return name ? `${name} <${email}>` : email;
}

function formatRecipientList(records: AreaChairRecord[]) {
  return records.map(formatRecipient).filter(Boolean).join("; ");
}

export function ACDashboardPanel({ areaChairs, papers }: ACDashboardPanelProps) {
  const [expandedAreaChair, setExpandedAreaChair] = useState<string | null>(null);
  const [copiedEmail, setCopiedEmail] = useState<{ target: string; preview: string } | null>(null);
  const [sortColumn, setSortColumn] = useState<SortColumn>("areaChair");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const missingMetaReviewsCount = useMemo(
    () => areaChairs.reduce((total, record) => total + Math.max(0, record.numPapers - record.metaReviewsDone), 0),
    [areaChairs]
  );
  const areaChairsWithEmails = useMemo(
    () => areaChairs.filter((record) => record.areaChairEmail),
    [areaChairs]
  );
  const areaChairEmails = useMemo(() => formatRecipientList(areaChairsWithEmails), [areaChairsWithEmails]);
  const papersByAreaChair = useMemo(() => {
    const grouped = new Map<string, PaperRecord[]>();
    for (const paper of papers) {
      const assignedPapers = grouped.get(paper.areaChair);
      if (assignedPapers) {
        assignedPapers.push(paper);
      } else {
        grouped.set(paper.areaChair, [paper]);
      }
    }

    for (const assignedPapers of grouped.values()) {
      assignedPapers.sort((left, right) => left.paperNumber - right.paperNumber);
    }

    return grouped;
  }, [papers]);
  const sortedAreaChairs = useMemo(
    () =>
      [...areaChairs].sort((left, right) => {
        let comparison = 0;

        switch (sortColumn) {
          case "areaChair":
            comparison = compareText(left.areaChair, right.areaChair, sortDirection);
            break;
          case "reviews":
            comparison = compareCountPair(
              left.totalCompletedReviews,
              left.totalExpectedReviews,
              right.totalCompletedReviews,
              right.totalExpectedReviews,
              sortDirection
            );
            break;
          case "papersReady":
            comparison = compareCountPair(
              left.papersReady,
              left.numPapers,
              right.papersReady,
              right.numPapers,
              sortDirection
            );
            break;
          case "metaReviews":
            comparison = compareCountPair(
              left.metaReviewsDone,
              left.numPapers,
              right.metaReviewsDone,
              right.numPapers,
              sortDirection
            );
            break;
          case "checklist":
            comparison = compareCountPair(
              left.acChecklistDone,
              left.numPapers,
              right.acChecklistDone,
              right.numPapers,
              sortDirection
            );
            break;
          case "allReviewsReady":
            comparison = compareBoolean(left.allReviewsReady, right.allReviewsReady, sortDirection);
            break;
          case "allMetaReviewsReady":
            comparison = compareBoolean(left.allMetaReviewsReady, right.allMetaReviewsReady, sortDirection);
            break;
          default:
            comparison = 0;
        }

        return comparison || compareText(left.areaChair, right.areaChair, "asc");
      }),
    [areaChairs, sortColumn, sortDirection]
  );

  function toggleAreaChairDetails(areaChair: string) {
    setExpandedAreaChair((currentAreaChair) => (currentAreaChair === areaChair ? null : areaChair));
  }

  async function copyEmails(text: string, target: string) {
    if (!text) {
      return;
    }

    if (!navigator.clipboard?.writeText) {
      return;
    }

    await navigator.clipboard.writeText(text);
    setCopiedEmail({ target, preview: text });
    window.setTimeout(() => {
      setCopiedEmail((currentEmail) => (currentEmail?.target === target ? null : currentEmail));
    }, 4200);
  }

  return (
    <section className="panel">
      <div className="section-header">
        <div>
          <p className="eyebrow">Rollup view</p>
          <div className="panel-title-row">
            <h2>Area Chairs</h2>
            <span aria-label={`${areaChairs.length} area chairs`} className="title-count-pill">
              {areaChairs.length}
            </span>
          </div>
        </div>
        <div className="ac-dashboard-header-controls">
          <div className="papers-summary-pills" aria-label="AC dashboard summary">
            <div className="papers-summary-pill">
              <span className="papers-summary-pill-label">Missing meta-reviews</span>
              <span className="papers-summary-pill-value">{missingMetaReviewsCount}</span>
            </div>
            <button
              aria-label={`Copy emails for all ${areaChairsWithEmails.length} meta-reviewers`}
              className="copy-all-emails-button"
              disabled={!areaChairEmails}
              onClick={() => copyEmails(areaChairEmails, "all-meta-reviewers")}
              type="button"
            >
              {copiedEmail?.target === "all-meta-reviewers"
                ? `Copied ${areaChairsWithEmails.length} ${areaChairsWithEmails.length === 1 ? "email" : "emails"}`
                : "Copy all emails"}
            </button>
          </div>
        </div>
      </div>

      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              {AC_SORT_DEFINITIONS.map((definition) => {
                const isActive = definition.column === sortColumn;
                const indicator = !isActive ? "↕" : sortDirection === "asc" ? "↑" : "↓";

                return (
                  <th
                    aria-sort={headerAriaSort(definition.column, sortColumn, sortDirection)}
                    key={definition.column}
                    scope="col"
                  >
                    <button
                      className={joinClasses("table-head-button", isActive && "active")}
                      onClick={() => {
                        setSortDirection((currentDirection) =>
                          nextDirection(definition.column, sortColumn, currentDirection)
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
            {sortedAreaChairs.map((record) => {
              const expanded = expandedAreaChair === record.areaChair;
              const recipient = formatRecipient(record);
              const assignedPapers = papersByAreaChair.get(record.areaChair) ?? [];

              return (
                <Fragment key={record.areaChair}>
                  <tr
                    aria-expanded={expanded}
                    className={joinClasses("clickable-row", expanded && "expanded")}
                    onClick={() => toggleAreaChairDetails(record.areaChair)}
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget) {
                        return;
                      }
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        toggleAreaChairDetails(record.areaChair);
                      }
                    }}
                    tabIndex={0}
                  >
                    <td className="monospace">{record.areaChair}</td>
                    <td>{formatCountPair(record.totalCompletedReviews, record.totalExpectedReviews)}</td>
                    <td>{formatCountPair(record.papersReady, record.numPapers)}</td>
                    <td>{formatCountPair(record.metaReviewsDone, record.numPapers)}</td>
                    <td>{formatCountPair(record.acChecklistDone, record.numPapers)}</td>
                    <td>
                      <TableBooleanIcon label="All papers ready" value={record.allReviewsReady} />
                    </td>
                    <td>
                      <TableBooleanIcon label="All meta-reviews ready" value={record.allMetaReviewsReady} />
                    </td>
                  </tr>

                  {expanded ? (
                    <tr className="detail-row" key={`${record.areaChair}-detail`}>
                      <td colSpan={7}>
                        <div className="collapsible-shell">
                          <div className="collapsible-inner">
                            <div className="detail-panel-content ac-paper-detail">
                              <div className="paper-detail-title ac-paper-detail-title">
                                <div>
                                  <span className="score-label">Assigned papers</span>
                                  <h3>{record.areaChair}</h3>
                                </div>
                                <button
                                  aria-label={`Copy email for ${recipient || record.areaChair}`}
                                  className="copy-email-button"
                                  disabled={!recipient}
                                  onClick={() => copyEmails(recipient, record.areaChair)}
                                  title={recipient || undefined}
                                  type="button"
                                >
                                  {copiedEmail?.target === record.areaChair
                                    ? `Copied! ${copiedEmail.preview}`
                                    : "Copy email"}
                                </button>
                              </div>

                              {assignedPapers.length > 0 ? (
                                <div className="ac-paper-list-shell">
                                  <table className="ac-paper-list">
                                    <thead>
                                      <tr>
                                        <th>Paper</th>
                                        <th>Title</th>
                                        <th>Reviews</th>
                                        <th>Ready</th>
                                        <th>Responses</th>
                                        <th>Checklist</th>
                                        <th>Meta</th>
                                        <th>Overall</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {assignedPapers.map((paper) => {
                                        const displayTitle =
                                          (paper.paperTitle || "").trim() || `Paper ${paper.paperNumber}`;

                                        return (
                                          <tr key={paper.paperId}>
                                            <td>
                                              <a href={paper.forumUrl} rel="noreferrer" target="_blank">
                                                {paper.paperNumber}
                                              </a>
                                            </td>
                                            <td>
                                              <span className="ac-paper-title">{displayTitle}</span>
                                            </td>
                                            <td>{formatCountPair(paper.completedReviews, paper.expectedReviews)}</td>
                                            <td>
                                              <TableBooleanIcon
                                                label={`Paper ${paper.paperNumber} ready`}
                                                value={paper.readyForRebuttal}
                                              />
                                            </td>
                                            <td>
                                              <TableBooleanIcon
                                                label={`Paper ${paper.paperNumber} responses`}
                                                value={paper.authorResponseReady}
                                              />
                                            </td>
                                            <td>
                                              <TableBooleanIcon
                                                label={`Paper ${paper.paperNumber} checklist`}
                                                value={paper.acChecklistReady}
                                              />
                                            </td>
                                            <td>{metaReviewCell(paper.metaReviewScore)}</td>
                                            <td>{formatScoreSummary(paper.overallAssessment)}</td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              ) : (
                                <p className="subtle-text">No paper records are available for this area chair.</p>
                              )}
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
  );
}
