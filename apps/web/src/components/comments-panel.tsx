"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { EmptyStateIcon } from "@/components/empty-state-icon";
import { formatScoreSummary } from "@/lib/format";
import type { CommentGroup, CommentRecord, PaperRecord } from "@/lib/types";

type CommentsPanelProps = {
  comments: CommentGroup[];
  papers?: PaperRecord[];
};

type CommentFilters = {
  search: string;
  type: string;
};

type CommentTypeBreakdown = [string, number][];
type DisplayCommentGroup = CommentGroup & {
  displayTitle: string;
  overallScoreLabel: string | null;
  postCount: number;
  typeBreakdown: CommentTypeBreakdown;
};

function filterNodes(nodes: CommentRecord[], filters: CommentFilters): CommentRecord[] {
  return nodes.flatMap((node) => {
    const filteredChildren = filterNodes(node.children, filters);
    const searchHit =
      !filters.search ||
      `${node.paperNumber} ${node.content} ${node.role} ${node.type}`.toLowerCase().includes(filters.search);
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

function CommentThread({ comment, depth = 0 }: { comment: CommentRecord; depth?: number }) {
  return (
    <article className="thread-node" style={{ marginLeft: `${depth * 20}px` }}>
      <div className="thread-meta">
        <div>
          <span className={`thread-type ${commentTypeClassName(comment.type)}`}>{comment.type}</span>
          <span className="thread-role">{comment.role}</span>
        </div>
        <span className="subtle-text">{comment.date || "Undated"}</span>
      </div>

      <a className="thread-link" href={comment.link} rel="noreferrer" target="_blank">
        View on OpenReview
      </a>

      <div className="thread-content">
        <ReactMarkdown components={{ img: () => null }} remarkPlugins={[remarkGfm]}>
          {comment.content}
        </ReactMarkdown>
      </div>

      {comment.children.length > 0 ? (
        <div className="thread-children">
          {comment.children.map((child) => (
            <CommentThread comment={child} depth={depth + 1} key={child.noteId} />
          ))}
        </div>
      ) : null}
    </article>
  );
}

function commentTypeClassName(type: string) {
  const normalizedType = type.toLowerCase();

  if (normalizedType.includes("author-editor")) {
    return "comment-type-author-editor";
  }
  if (normalizedType.includes("review issue")) {
    return "comment-type-review-issue";
  }
  if (normalizedType.includes("program chair")) {
    return "comment-type-program-chair";
  }

  return "comment-type-comment";
}

function countComments(nodes: CommentRecord[]): number {
  return nodes.reduce((total, node) => total + 1 + countComments(node.children), 0);
}

function countCommentTypes(nodes: CommentRecord[], counts = new Map<string, number>()) {
  nodes.forEach((node) => {
    counts.set(node.type, (counts.get(node.type) ?? 0) + 1);
    countCommentTypes(node.children, counts);
  });

  return [...counts.entries()].sort(([leftType], [rightType]) =>
    leftType.localeCompare(rightType, undefined, { sensitivity: "base" })
  );
}

function formatPostCount(count: number) {
  return `${count} ${count === 1 ? "post" : "posts"}`;
}

export function CommentsPanel({ comments, papers = [] }: CommentsPanelProps) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [expandedPaperIds, setExpandedPaperIds] = useState<Set<string>>(() => new Set());
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());

  const paperById = useMemo(() => new Map(papers.map((paper) => [paper.paperId, paper])), [papers]);

  const types = useMemo(
    () => [...new Set(comments.flatMap((group) => group.items.flatMap(flattenTypes)))].sort(),
    [comments]
  );

  useEffect(() => {
    if (typeFilter !== "all" && !types.includes(typeFilter)) {
      setTypeFilter("all");
    }
  }, [typeFilter, types]);

  const filteredGroups = useMemo<DisplayCommentGroup[]>(
    () =>
      comments
        .map((group) => {
          const paper = paperById.get(group.paperId);
          const items = filterNodes(group.items, {
            search: deferredSearch,
            type: typeFilter
          });
          return {
            ...group,
            displayTitle: (group.paperTitle || "").trim() || `Paper ${group.paperNumber}`,
            overallScoreLabel: paper ? `Overall ${formatScoreSummary(paper.overallAssessment)}` : null,
            items,
            postCount: countComments(items),
            typeBreakdown: countCommentTypes(items)
          };
        })
        .filter((group) => group.items.length > 0),
    [comments, deferredSearch, paperById, typeFilter]
  );

  const isEmptyDataset = comments.length === 0;

  function togglePaperThread(paperId: string) {
    setExpandedPaperIds((currentIds) => {
      const nextIds = new Set(currentIds);

      if (nextIds.has(paperId)) {
        nextIds.delete(paperId);
      } else {
        nextIds.add(paperId);
      }

      return nextIds;
    });
  }

  return (
    <section className="panel">
      <div className="section-header comments-panel-header">
        <div>
          <p className="eyebrow">Exception handling</p>
          <h2>Comments</h2>
        </div>
        <div className="comments-header-controls">
          <label className="field compact comments-search-field">
            <span className="sr-only">Search</span>
            <input
              aria-label="Search comments"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Paper number, type, or content"
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
          <h3>No comments need attention.</h3>
          <p>Program Chair comments, confidential comments, and issue reports will appear here when they are available.</p>
        </div>
      ) : null}

      {!isEmptyDataset && filteredGroups.length === 0 ? (
        <div className="empty-state">
          <EmptyStateIcon />
          <h3>No comments match the current filters.</h3>
          <p>Try a broader search term or switch back to all comment types.</p>
        </div>
      ) : null}

      <div className="comment-groups">
        {filteredGroups.map((group) => {
          const expanded = expandedPaperIds.has(group.paperId);

          return (
            <section className="paper-thread" key={group.paperId}>
              <button
                aria-label={`Paper ${group.paperNumber} ${group.displayTitle} ${formatPostCount(group.postCount)}`}
                aria-expanded={expanded}
                className="paper-thread-header paper-thread-toggle"
                onClick={() => togglePaperThread(group.paperId)}
                type="button"
              >
                <div>
                  <p className="eyebrow paper-thread-eyebrow">
                    <span>Paper {group.paperNumber}</span>
                    {group.overallScoreLabel ? (
                      <span className="paper-thread-score-context">{group.overallScoreLabel}</span>
                    ) : null}
                  </p>
                  <h3 className="paper-thread-title">{group.displayTitle}</h3>
                  <span className="paper-thread-breakdown" aria-label="Comment type breakdown">
                    {group.typeBreakdown.map(([type, count]) => (
                      <span
                        className={`paper-thread-breakdown-item ${commentTypeClassName(type)}`}
                        key={type}
                      >
                        {type}: {count}
                      </span>
                    ))}
                  </span>
                </div>
                <span className="paper-thread-summary">
                  <span>{formatPostCount(group.postCount)}</span>
                  <span aria-hidden="true" className="paper-thread-caret">
                    {expanded ? "↑" : "↓"}
                  </span>
                </span>
              </button>

              {expanded ? (
                <div className="collapsible-shell">
                  <div className="collapsible-inner">
                    <div className="paper-thread-body">
                      <a className="thread-link paper-thread-forum-link" href={group.forumUrl} rel="noreferrer" target="_blank">
                        Open forum
                      </a>

                      <div className="thread-list">
                        {group.items.map((item) => (
                          <CommentThread comment={item} key={item.noteId} />
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </section>
  );
}

function flattenTypes(comment: CommentRecord): string[] {
  return [comment.type, ...comment.children.flatMap(flattenTypes)];
}
