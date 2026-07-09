"use client";

import { Fragment, useDeferredValue, useMemo, useState } from "react";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { EmptyStateIcon } from "@/components/empty-state-icon";
import { TableBooleanIcon } from "@/components/table-boolean-icon";
import { formatCountPair, formatScoreSummary, joinClasses } from "@/lib/format";
import type { AlertGroup, AlertRecord, AreaChairRecord, PaperRecord } from "@/lib/types";

type AlertsPanelProps = {
  alerts: AlertGroup[];
  areaChairs: AreaChairRecord[];
  papers: PaperRecord[];
};

type AlertFilters = {
  search: string;
  type: string;
};

type DisplayAlertGroup = AlertGroup & {
  delayCount: number;
  emergencyCount: number;
};

type SortColumn =
  | "paperNumber"
  | "areaChair"
  | "paperType"
  | "reviews"
  | "readyForRebuttal"
  | "emergency"
  | "delay"
  | "overallAssessment";

type SortDirection = "asc" | "desc";

type SortDefinition = {
  column: SortColumn;
  label: string;
  defaultDirection: SortDirection;
};

const ALERT_SORT_DEFINITIONS: SortDefinition[] = [
  { column: "paperNumber", label: "Paper", defaultDirection: "asc" },
  { column: "areaChair", label: "Area Chair", defaultDirection: "asc" },
  { column: "paperType", label: "Type", defaultDirection: "asc" },
  { column: "reviews", label: "Reviews", defaultDirection: "desc" },
  { column: "readyForRebuttal", label: "Ready", defaultDirection: "asc" },
  { column: "emergency", label: "Emergency", defaultDirection: "desc" },
  { column: "delay", label: "Delay", defaultDirection: "desc" },
  { column: "overallAssessment", label: "Overall", defaultDirection: "desc" }
];

function filterNodes(nodes: AlertRecord[], filters: AlertFilters): AlertRecord[] {
  return nodes.flatMap((node) => {
    const filteredChildren = filterNodes(node.children, filters);
    const signerLabel = node.signerLabel ?? "";
    const searchHit =
      !filters.search ||
      `${node.paperNumber} ${node.content} ${node.role} ${signerLabel} ${node.type}`
        .toLowerCase()
        .includes(filters.search);
    const typeHit = filters.type === "all" || node.type === filters.type;
    const includeSelf = searchHit && typeHit;

    if (!includeSelf && filteredChildren.length === 0) {
      return [];
    }

    return [
      {
        ...node,
        children: filteredChildren
      }
    ];
  });
}

function AlertThread({ alert, depth = 0 }: { alert: AlertRecord; depth?: number }) {
  return (
    <article className="thread-node alert-thread-node" style={{ marginLeft: `${depth * 20}px` }}>
      <div className="thread-meta">
        <div>
          <span className={`thread-type ${alertTypeClassName(alert.type)}`}>{alert.type}</span>
          <span className="thread-role">{alert.role}</span>
          {alert.signerLabel ? <span className="thread-role">{alert.signerLabel}</span> : null}
        </div>
        <span className="subtle-text">{alert.date || "Undated"}</span>
      </div>

      <a className="thread-link" href={alert.link} rel="noreferrer" target="_blank">
        View on OpenReview
      </a>

      <div className="thread-content">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{alert.content}</ReactMarkdown>
      </div>

      {alert.children.length > 0 ? (
        <div className="thread-children">
          {alert.children.map((child) => (
            <AlertThread alert={child} depth={depth + 1} key={child.noteId} />
          ))}
        </div>
      ) : null}
    </article>
  );
}

function alertTypeClassName(type: string) {
  const normalizedType = type.toLowerCase();

  if (normalizedType.includes("emergency")) {
    return "comment-type-alert-emergency";
  }
  if (normalizedType.includes("delay")) {
    return "comment-type-alert-delay";
  }
  if (normalizedType.includes("official comment")) {
    return "comment-type-comment";
  }

  return "comment-type-alert";
}

function profileIdDisplayName(profileId: string) {
  const normalized = profileId.replace(/^~/, "").replace(/\d+$/, "").replaceAll("_", " ").trim();
  return normalized || profileId;
}

function flattenTypes(alert: AlertRecord): string[] {
  return [alert.type, ...alert.children.flatMap(flattenTypes)];
}

function countAlertType(nodes: AlertRecord[], type: string): number {
  return nodes.reduce(
    (total, node) => total + (node.type === type ? 1 : 0) + countAlertType(node.children, type),
    0
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

  const definition = ALERT_SORT_DEFINITIONS.find((item) => item.column === column);
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

function compareReviewProgress(
  leftCompleted: number | null | undefined,
  leftExpected: number | null | undefined,
  rightCompleted: number | null | undefined,
  rightExpected: number | null | undefined,
  direction: SortDirection
) {
  const reviewDirection = direction === "desc" ? "asc" : "desc";

  return (
    compareNullableNumber(leftCompleted, rightCompleted, reviewDirection) ||
    compareNullableNumber(leftExpected, rightExpected, reviewDirection)
  );
}

function headerAriaSort(column: SortColumn, sortColumn: SortColumn, sortDirection: SortDirection) {
  if (column !== sortColumn) {
    return "none";
  }
  return sortDirection === "asc" ? "ascending" : "descending";
}

function paperSearchText(group: AlertGroup, paper: PaperRecord | undefined, areaChairName: string) {
  return [
    group.paperNumber,
    group.paperId,
    group.paperTitle,
    paper?.paperTitle,
    paper?.areaChair,
    areaChairName
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function AlertsPanel({ alerts, areaChairs, papers }: AlertsPanelProps) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [sortColumn, setSortColumn] = useState<SortColumn>("readyForRebuttal");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [expandedPaperId, setExpandedPaperId] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());

  const paperById = useMemo(() => new Map(papers.map((paper) => [paper.paperId, paper])), [papers]);
  const areaChairById = useMemo(
    () => new Map(areaChairs.map((areaChair) => [areaChair.areaChair, areaChair])),
    [areaChairs]
  );
  const types = useMemo(
    () => [...new Set(alerts.flatMap((group) => group.items.flatMap(flattenTypes)))].sort(),
    [alerts]
  );
  const { readyAlertPapers, totalAlertPapers, totalDelayCount, totalEmergencyCount } = useMemo(
    () => ({
      readyAlertPapers: alerts.reduce((total, group) => {
        const paper = paperById.get(group.paperId);
        return total + (paper?.readyForRebuttal ? 1 : 0);
      }, 0),
      totalAlertPapers: alerts.length,
      totalDelayCount: alerts.reduce(
        (total, group) => total + countAlertType(group.items, "Delay Notification"),
        0
      ),
      totalEmergencyCount: alerts.reduce(
        (total, group) => total + countAlertType(group.items, "Emergency Declaration"),
        0
      )
    }),
    [alerts, paperById]
  );
  const activeSortColumn = ALERT_SORT_DEFINITIONS.some((definition) => definition.column === sortColumn)
    ? sortColumn
    : "paperNumber";
  const tableColumnCount = ALERT_SORT_DEFINITIONS.length;

  const filteredGroups = useMemo<DisplayAlertGroup[]>(
    () =>
      alerts
        .map((group) => {
          const paper = paperById.get(group.paperId);
          const areaChair = paper ? areaChairById.get(paper.areaChair) : undefined;
          const areaChairName =
            areaChair?.areaChairName || (paper?.areaChair ? profileIdDisplayName(paper.areaChair) : "");
          const paperHit = Boolean(
            deferredSearch && paperSearchText(group, paper, areaChairName).includes(deferredSearch)
          );
          const items = filterNodes(group.items, {
            search: paperHit ? "" : deferredSearch,
            type: typeFilter
          });

          return {
            ...group,
            delayCount: countAlertType(items, "Delay Notification"),
            emergencyCount: countAlertType(items, "Emergency Declaration"),
            items
          };
        })
        .filter((group) => group.items.length > 0)
        .sort((left, right) => {
          const leftPaper = paperById.get(left.paperId);
          const rightPaper = paperById.get(right.paperId);
          const leftAreaChair = leftPaper ? areaChairById.get(leftPaper.areaChair) : undefined;
          const rightAreaChair = rightPaper ? areaChairById.get(rightPaper.areaChair) : undefined;
          const leftAreaChairName =
            leftPaper?.areaChair ||
            leftAreaChair?.areaChairName ||
            (leftPaper?.areaChair ? profileIdDisplayName(leftPaper.areaChair) : "Unassigned");
          const rightAreaChairName =
            rightPaper?.areaChair ||
            rightAreaChair?.areaChairName ||
            (rightPaper?.areaChair ? profileIdDisplayName(rightPaper.areaChair) : "Unassigned");

          switch (activeSortColumn) {
            case "paperNumber":
              return sortDirection === "asc"
                ? left.paperNumber - right.paperNumber
                : right.paperNumber - left.paperNumber;
            case "areaChair":
              return (
                compareText(leftAreaChairName, rightAreaChairName, sortDirection) ||
                left.paperNumber - right.paperNumber
              );
            case "paperType":
              return (
                compareText(leftPaper?.paperType || "", rightPaper?.paperType || "", sortDirection) ||
                left.paperNumber - right.paperNumber
              );
            case "reviews":
              return (
                compareReviewProgress(
                  leftPaper?.completedReviews,
                  leftPaper?.expectedReviews,
                  rightPaper?.completedReviews,
                  rightPaper?.expectedReviews,
                  sortDirection
                ) || left.paperNumber - right.paperNumber
              );
            case "readyForRebuttal":
              return (
                compareBoolean(
                  leftPaper?.readyForRebuttal ?? false,
                  rightPaper?.readyForRebuttal ?? false,
                  sortDirection
                ) || left.paperNumber - right.paperNumber
              );
            case "emergency":
              return (
                compareNullableNumber(left.emergencyCount, right.emergencyCount, sortDirection) ||
                left.paperNumber - right.paperNumber
              );
            case "delay":
              return (
                compareNullableNumber(left.delayCount, right.delayCount, sortDirection) ||
                left.paperNumber - right.paperNumber
              );
            case "overallAssessment":
              return (
                compareNullableNumber(
                  leftPaper?.overallAssessment.average,
                  rightPaper?.overallAssessment.average,
                  sortDirection
                ) || left.paperNumber - right.paperNumber
              );
            default:
              return left.paperNumber - right.paperNumber;
          }
        }),
    [activeSortColumn, alerts, areaChairById, deferredSearch, paperById, sortDirection, typeFilter]
  );

  const isEmptyDataset = alerts.length === 0;

  function togglePaperThread(paperId: string) {
    setExpandedPaperId((currentPaperId) => (currentPaperId === paperId ? null : paperId));
  }

  return (
    <section className="panel">
      <div className="section-header comments-panel-header">
        <div>
          <p className="eyebrow">Review chasing</p>
          <h2>Alerts</h2>
        </div>
        <div className="comments-header-controls alerts-header-controls">
          <div className="papers-summary-pills" aria-label="Alerts summary">
            <div className="papers-summary-pill">
              <span className="papers-summary-pill-label">Ready</span>
              <span className="papers-summary-pill-value">{`${readyAlertPapers}/${totalAlertPapers}`}</span>
            </div>
            <div className="papers-summary-pill">
              <span className="papers-summary-pill-label">Emergency</span>
              <span className="papers-summary-pill-value">{totalEmergencyCount}</span>
            </div>
            <div className="papers-summary-pill">
              <span className="papers-summary-pill-label">Delay</span>
              <span className="papers-summary-pill-value">{totalDelayCount}</span>
            </div>
          </div>

          <label className="field compact comments-search-field">
            <span className="sr-only">Search</span>
            <input
              aria-label="Search alerts"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Paper, AC, type, signer, or content"
              value={search}
            />
          </label>

          <label className="field compact comments-type-field">
            <span className="sr-only">Type</span>
            <select onChange={(event) => setTypeFilter(event.target.value)} value={typeFilter}>
              <option value="all">All types</option>
              {types.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {isEmptyDataset ? (
        <div className="empty-state">
          <EmptyStateIcon />
          <h3>No review alerts need attention.</h3>
          <p>Delay notifications and emergency declarations will appear here when they are posted.</p>
        </div>
      ) : null}

      {!isEmptyDataset && filteredGroups.length === 0 ? (
        <div className="empty-state">
          <EmptyStateIcon />
          <h3>No alerts match the current filters.</h3>
          <p>Try a broader search term or switch back to all alert types.</p>
        </div>
      ) : null}

      {!isEmptyDataset && filteredGroups.length > 0 ? (
        <div className="table-scroll">
          <table className="data-table alerts-table">
            <thead>
              <tr>
                {ALERT_SORT_DEFINITIONS.map((definition) => {
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
                            nextDirection(definition.column, activeSortColumn, currentDirection)
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
              {filteredGroups.map((group) => {
                const paper = paperById.get(group.paperId);
                const areaChair = paper ? areaChairById.get(paper.areaChair) : undefined;
                const areaChairName =
                  areaChair?.areaChairName || (paper?.areaChair ? profileIdDisplayName(paper.areaChair) : "Unassigned");
                const expanded = expandedPaperId === group.paperId;
                const reviewStatus = paper
                  ? formatCountPair(paper.completedReviews, paper.expectedReviews)
                  : "Unknown";
                const paperType = paper?.paperType || "Unspecified";
                const overallScore = paper ? formatScoreSummary(paper.overallAssessment) : "N/A";

                return (
                  <Fragment key={group.paperId}>
                    <tr
                      aria-expanded={expanded}
                      className={joinClasses("clickable-row", expanded && "expanded")}
                      onClick={() => togglePaperThread(group.paperId)}
                      onKeyDown={(event) => {
                        if (event.target !== event.currentTarget) {
                          return;
                        }
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          togglePaperThread(group.paperId);
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
                            togglePaperThread(group.paperId);
                          }}
                          type="button"
                        >
                          <strong>{group.paperNumber}</strong>
                        </button>
                      </td>
                      <td>{paper?.areaChair || areaChairName}</td>
                      <td>{paperType}</td>
                      <td>{reviewStatus}</td>
                      <td>
                        <TableBooleanIcon label="Ready" value={paper?.readyForRebuttal ?? false} />
                      </td>
                      <td>
                        <span className="alert-count-badge emergency">{group.emergencyCount}</span>
                      </td>
                      <td>
                        <span className="alert-count-badge delay">{group.delayCount}</span>
                      </td>
                      <td>{overallScore}</td>
                    </tr>

                    {expanded ? (
                      <tr className="detail-row" key={`${group.paperId}-detail`}>
                        <td colSpan={tableColumnCount}>
                          <div className="collapsible-shell">
                            <div className="collapsible-inner">
                              <div className="detail-panel-content alert-detail-panel">
                                <div className="paper-detail-title alert-detail-title">
                                  <div>
                                    <span className="score-label">Alert details</span>
                                    <h3>{(group.paperTitle || "").trim() || `Paper ${group.paperNumber}`}</h3>
                                  </div>
                                  <a className="thread-link" href={group.forumUrl} rel="noreferrer" target="_blank">
                                    Open forum
                                  </a>
                                </div>

                                <div className="thread-list alert-detail-list">
                                  {group.items.map((item) => (
                                    <AlertThread alert={item} key={item.noteId} />
                                  ))}
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
      ) : null}
    </section>
  );
}
