"use client";

import { useDeferredValue, useMemo, useState } from "react";

import { formatScore, joinClasses } from "@/lib/format";
import type { PaperRecord } from "@/lib/types";

type RecommendationPanelProps = {
  papers: PaperRecord[];
  totalPapers?: number;
};

type SortColumn =
  | "paperNumber"
  | "paperType"
  | "metaReviewScore"
  | "overallAssessment"
  | "recommendation"
  | "recommendationConfidence"
  | "presentationForm";

type SortDirection = "asc" | "desc";

type SortDefinition = {
  column: SortColumn;
  label: string;
  defaultDirection: SortDirection;
};

const SORT_DEFINITIONS: SortDefinition[] = [
  { column: "paperNumber", label: "Paper", defaultDirection: "asc" },
  { column: "paperType", label: "Type", defaultDirection: "asc" },
  { column: "metaReviewScore", label: "Meta", defaultDirection: "desc" },
  { column: "overallAssessment", label: "Overall", defaultDirection: "desc" },
  { column: "recommendationConfidence", label: "Confidence", defaultDirection: "desc" },
  { column: "recommendation", label: "Recommendation", defaultDirection: "asc" },
  { column: "presentationForm", label: "Presentation Form", defaultDirection: "asc" }
];

function recommendationColumnClass(column: SortColumn, emphasizePriority = false) {
  const isTextColumn = ["paperNumber", "paperType", "recommendation", "presentationForm"].includes(
    column
  );
  const isPriorityColumn =
    emphasizePriority && (column === "metaReviewScore" || column === "overallAssessment");

  return joinClasses(
    isTextColumn ? "papers-table-column-text" : "papers-table-column-center",
    isPriorityColumn && "papers-table-column-priority"
  );
}

function nextDirection(
  column: SortColumn,
  currentColumn: SortColumn,
  currentDirection: SortDirection
): SortDirection {
  if (column === currentColumn) {
    return currentDirection === "asc" ? "desc" : "asc";
  }

  return SORT_DEFINITIONS.find((item) => item.column === column)?.defaultDirection ?? "asc";
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

function compareOptionalText(
  left: string | null | undefined,
  right: string | null | undefined,
  direction: SortDirection
) {
  const normalizedLeft = (left ?? "").trim();
  const normalizedRight = (right ?? "").trim();
  if (!normalizedLeft && !normalizedRight) {
    return 0;
  }
  if (!normalizedLeft) {
    return 1;
  }
  if (!normalizedRight) {
    return -1;
  }

  const comparison = normalizedLeft.localeCompare(normalizedRight, undefined, {
    sensitivity: "base"
  });
  return direction === "asc" ? comparison : -comparison;
}

function headerAriaSort(
  column: SortColumn,
  sortColumn: SortColumn,
  sortDirection: SortDirection
) {
  if (column !== sortColumn) {
    return "none";
  }
  return sortDirection === "asc" ? "ascending" : "descending";
}

function hasRecommendation(paper: PaperRecord) {
  return Boolean(paper.recommendationPosted || paper.recommendation?.trim());
}

export function RecommendationPanel({
  papers,
  totalPapers = papers.length
}: RecommendationPanelProps) {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());
  const [sortColumn, setSortColumn] = useState<SortColumn>("paperNumber");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  const filteredPapers = useMemo(
    () =>
      [...papers]
        .filter((paper) => {
          if (!deferredSearch) {
            return true;
          }

          return [
            String(paper.paperNumber),
            paper.paperTitle,
            paper.paperType,
            paper.recommendation,
            paper.recommendationConfidence == null
              ? ""
              : String(paper.recommendationConfidence),
            paper.presentationForm
          ].some((value) => (value ?? "").toLowerCase().includes(deferredSearch));
        })
        .sort((left, right) => {
          let comparison = 0;
          switch (sortColumn) {
            case "paperNumber":
              comparison =
                sortDirection === "asc"
                  ? left.paperNumber - right.paperNumber
                  : right.paperNumber - left.paperNumber;
              break;
            case "paperType":
              comparison = compareOptionalText(left.paperType, right.paperType, sortDirection);
              break;
            case "metaReviewScore":
              comparison = compareNullableNumber(
                left.metaReviewScore,
                right.metaReviewScore,
                sortDirection
              );
              break;
            case "overallAssessment":
              comparison = compareNullableNumber(
                left.overallAssessment.average,
                right.overallAssessment.average,
                sortDirection
              );
              break;
            case "recommendation":
              comparison = compareOptionalText(
                left.recommendation,
                right.recommendation,
                sortDirection
              );
              break;
            case "recommendationConfidence":
              comparison = compareNullableNumber(
                left.recommendationConfidence,
                right.recommendationConfidence,
                sortDirection
              );
              break;
            case "presentationForm":
              comparison = compareOptionalText(
                left.presentationForm,
                right.presentationForm,
                sortDirection
              );
              break;
          }

          return comparison || left.paperNumber - right.paperNumber;
        }),
    [deferredSearch, papers, sortColumn, sortDirection]
  );

  const recommendationCount = filteredPapers.filter(hasRecommendation).length;

  return (
    <section className="panel papers-panel recommendation-panel">
      <div className="section-header papers-panel-header">
        <div>
          <p className="eyebrow">Commitment workspace</p>
          <div className="panel-title-row">
            <h2>Recommendation</h2>
            <span aria-label={`${totalPapers} recommendation papers`} className="title-count-pill">
              {totalPapers}
            </span>
          </div>
        </div>

        <div className="papers-header-controls">
          <div className="papers-summary-pills" aria-label="Recommendation summary">
            <div className="papers-summary-pill">
              <span className="papers-summary-pill-label">Posted</span>
              <span className="papers-summary-pill-value">
                {recommendationCount}/{filteredPapers.length}
              </span>
            </div>
          </div>
          <div className="papers-header-search">
            <input
              aria-label="Search recommendations"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search paper, type, recommendation, or form"
              value={search}
            />
          </div>
        </div>
      </div>

      <div className="table-scroll">
        <table aria-label="SAC recommendations" className="data-table recommendation-table">
          <thead>
            <tr>
              {SORT_DEFINITIONS.map((definition) => {
                const isActive = definition.column === sortColumn;
                const indicator = !isActive ? "↕" : sortDirection === "asc" ? "↑" : "↓";

                return (
                  <th
                    aria-sort={headerAriaSort(definition.column, sortColumn, sortDirection)}
                    className={recommendationColumnClass(definition.column)}
                    data-column={definition.column}
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
            {filteredPapers.length === 0 ? (
              <tr>
                <td className="empty-cell" colSpan={SORT_DEFINITIONS.length}>
                  No recommendations match the current search.
                </td>
              </tr>
            ) : null}

            {filteredPapers.map((paper) => {
              const recommendation = paper.recommendation?.trim();
              const presentationForm = paper.presentationForm?.trim();

              return (
                <tr key={paper.paperId}>
                  <td
                    className={recommendationColumnClass("paperNumber")}
                    data-column="paperNumber"
                  >
                    <a
                      aria-label={`Open paper ${paper.paperNumber} in OpenReview`}
                      className="recommendation-paper-link"
                      href={paper.forumUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {paper.paperNumber}
                    </a>
                  </td>
                  <td className={recommendationColumnClass("paperType")} data-column="paperType">
                    {paper.paperType || "Unspecified"}
                  </td>
                  <td
                    className={recommendationColumnClass("metaReviewScore", true)}
                    data-column="metaReviewScore"
                  >
                    {formatScore(paper.metaReviewScore)}
                  </td>
                  <td
                    className={recommendationColumnClass("overallAssessment", true)}
                    data-column="overallAssessment"
                  >
                    {formatScore(paper.overallAssessment.average)}
                  </td>
                  <td
                    className={recommendationColumnClass("recommendationConfidence")}
                    data-column="recommendationConfidence"
                  >
                    {formatScore(paper.recommendationConfidence)}
                  </td>
                  <td
                    className={recommendationColumnClass("recommendation")}
                    data-column="recommendation"
                  >
                    <span className={joinClasses("recommendation-value", !recommendation && "empty")}>
                      {recommendation || "N/A"}
                    </span>
                  </td>
                  <td
                    className={recommendationColumnClass("presentationForm")}
                    data-column="presentationForm"
                  >
                    <span className={joinClasses("presentation-form-value", !presentationForm && "empty")}>
                      {presentationForm || "N/A"}
                    </span>
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
