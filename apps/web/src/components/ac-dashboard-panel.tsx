"use client";

import { Fragment, useState } from "react";

import { TableBooleanIcon } from "@/components/table-boolean-icon";
import { formatCountPair, formatScore, formatScoreSummary, joinClasses } from "@/lib/format";
import type { AreaChairRecord, PaperRecord } from "@/lib/types";

type ACDashboardPanelProps = {
  areaChairs: AreaChairRecord[];
  papers: PaperRecord[];
};

function metaReviewCell(score: number | null) {
  return score == null ? <TableBooleanIcon label="Meta-review" value={false} /> : formatScore(score);
}

export function ACDashboardPanel({ areaChairs, papers }: ACDashboardPanelProps) {
  const [expandedAreaChair, setExpandedAreaChair] = useState<string | null>(null);
  const missingMetaReviewsCount = areaChairs.reduce(
    (total, record) => total + Math.max(0, record.numPapers - record.metaReviewsDone),
    0
  );

  function toggleAreaChairDetails(areaChair: string) {
    setExpandedAreaChair((currentAreaChair) => (currentAreaChair === areaChair ? null : areaChair));
  }

  return (
    <section className="panel">
      <div className="section-header">
        <div>
          <p className="eyebrow">Rollup view</p>
          <h2>AC Dashboard</h2>
        </div>
        <div className="ac-dashboard-header-controls">
          <div className="papers-summary-pills" aria-label="AC dashboard summary">
            <div className="papers-summary-pill">
              <span className="papers-summary-pill-label">Missing meta-reviews</span>
              <span className="papers-summary-pill-value">{missingMetaReviewsCount}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Area Chair</th>
              <th>Reviews</th>
              <th>Papers ready</th>
              <th>Meta-reviews</th>
              <th>Checklist</th>
              <th>All papers ready</th>
              <th>All meta-reviews ready</th>
            </tr>
          </thead>
          <tbody>
            {areaChairs.map((record) => {
              const expanded = expandedAreaChair === record.areaChair;
              const assignedPapers = papers
                .filter((paper) => paper.areaChair === record.areaChair)
                .sort((left, right) => left.paperNumber - right.paperNumber);

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
                              <div className="paper-detail-title">
                                <span className="score-label">Assigned papers</span>
                                <h3>{record.areaChair}</h3>
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
