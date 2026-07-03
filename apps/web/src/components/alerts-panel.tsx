"use client";

import { Fragment, useDeferredValue, useState } from "react";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { formatCountPair, formatScore, joinClasses } from "@/lib/format";
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
  const [expandedPaperId, setExpandedPaperId] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());

  const paperById = new Map(papers.map((paper) => [paper.paperId, paper]));
  const areaChairById = new Map(areaChairs.map((areaChair) => [areaChair.areaChair, areaChair]));
  const types = [...new Set(alerts.flatMap((group) => group.items.flatMap(flattenTypes)))].sort();
  const totalEmergencyCount = alerts.reduce(
    (total, group) => total + countAlertType(group.items, "Emergency Declaration"),
    0
  );
  const totalDelayCount = alerts.reduce(
    (total, group) => total + countAlertType(group.items, "Delay Notification"),
    0
  );

  const filteredGroups = alerts
    .map((group) => {
      const paper = paperById.get(group.paperId);
      const areaChair = paper ? areaChairById.get(paper.areaChair) : undefined;
      const areaChairName =
        areaChair?.areaChairName || (paper?.areaChair ? profileIdDisplayName(paper.areaChair) : "");
      const paperHit = Boolean(deferredSearch && paperSearchText(group, paper, areaChairName).includes(deferredSearch));

      return {
        ...group,
        items: filterNodes(group.items, {
          search: paperHit ? "" : deferredSearch,
          type: typeFilter
        })
      };
    })
    .filter((group) => group.items.length > 0)
    .sort((left, right) => left.paperNumber - right.paperNumber);

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
          <h3>No review alerts were found.</h3>
          <p>This ARR batch has no delay notifications or emergency declarations in your SAC scope.</p>
        </div>
      ) : null}

      {!isEmptyDataset && filteredGroups.length === 0 ? (
        <div className="empty-state">
          <h3>No alerts match the current filters.</h3>
          <p>Clear the search or relax the type filter to widen the view.</p>
        </div>
      ) : null}

      {!isEmptyDataset && filteredGroups.length > 0 ? (
        <div className="table-scroll">
          <table className="data-table alerts-table">
            <thead>
              <tr>
                <th>Paper</th>
                <th>Area Chair</th>
                <th>Type</th>
                <th>Reviews</th>
                <th>Emergency</th>
                <th>Delay</th>
                <th>Overall</th>
              </tr>
            </thead>
            <tbody>
              {filteredGroups.map((group) => {
                const paper = paperById.get(group.paperId);
                const areaChair = paper ? areaChairById.get(paper.areaChair) : undefined;
                const areaChairName =
                  areaChair?.areaChairName || (paper?.areaChair ? profileIdDisplayName(paper.areaChair) : "Unassigned");
                const expanded = expandedPaperId === group.paperId;
                const emergencyCount = countAlertType(group.items, "Emergency Declaration");
                const delayCount = countAlertType(group.items, "Delay Notification");
                const reviewStatus = paper
                  ? formatCountPair(paper.completedReviews, paper.expectedReviews)
                  : "Unknown";
                const paperType = paper?.paperType || "Unspecified";
                const overallScore = paper ? formatScore(paper.overallAssessment.average) : "Pending";

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
                        <span className="alert-count-badge emergency">{emergencyCount}</span>
                      </td>
                      <td>
                        <span className="alert-count-badge delay">{delayCount}</span>
                      </td>
                      <td>{overallScore}</td>
                    </tr>

                    {expanded ? (
                      <tr className="detail-row" key={`${group.paperId}-detail`}>
                        <td colSpan={7}>
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
