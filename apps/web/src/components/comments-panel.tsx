"use client";

import { useDeferredValue, useState } from "react";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { CommentGroup, CommentRecord } from "@/lib/types";

type CommentsPanelProps = {
  comments: CommentGroup[];
};

type CommentFilters = {
  search: string;
  type: string;
  role: string;
};

function filterNodes(nodes: CommentRecord[], filters: CommentFilters): CommentRecord[] {
  return nodes.flatMap((node) => {
    const filteredChildren = filterNodes(node.children, filters);
    const searchHit =
      !filters.search ||
      `${node.paperNumber} ${node.content} ${node.role} ${node.type}`.toLowerCase().includes(filters.search);
    const typeHit = filters.type === "all" || node.type === filters.type;
    const roleHit = filters.role === "all" || node.role === filters.role;
    const includeSelf = searchHit && typeHit && roleHit;

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
          <span className="thread-type">{comment.type}</span>
          <span className="thread-role">{comment.role}</span>
        </div>
        <span className="subtle-text">{comment.date || "Undated"}</span>
      </div>

      <a className="thread-link" href={comment.link} rel="noreferrer" target="_blank">
        View on OpenReview
      </a>

      <div className="thread-content">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{comment.content}</ReactMarkdown>
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

function countComments(nodes: CommentRecord[]): number {
  return nodes.reduce((total, node) => total + 1 + countComments(node.children), 0);
}

function formatPostCount(count: number) {
  return `${count} ${count === 1 ? "post" : "posts"}`;
}

export function CommentsPanel({ comments }: CommentsPanelProps) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [roleFilter, setRoleFilter] = useState("all");
  const [expandedPaperIds, setExpandedPaperIds] = useState<Set<string>>(() => new Set());
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());

  const types = [...new Set(comments.flatMap((group) => group.items.flatMap(flattenTypes)))].sort();
  const roles = [...new Set(comments.flatMap((group) => group.items.flatMap(flattenRoles)))].sort();

  const filteredGroups = comments
    .map((group) => ({
      ...group,
      items: filterNodes(group.items, {
        search: deferredSearch,
        type: typeFilter,
        role: roleFilter
      })
    }))
    .filter((group) => group.items.length > 0);

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
      <div className="section-header">
        <div>
          <p className="eyebrow">Exception handling</p>
          <h2>Comments</h2>
        </div>
        <p className="section-note">
          Threaded comments, confidential notes, and issue reports grouped by paper so follow-up is
          easy to scan.
        </p>
      </div>

      <div className="filters-grid tight">
        <label className="field compact">
          <span>Search</span>
          <input
            aria-label="Search comments"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Paper number, type, or content"
            value={search}
          />
        </label>

        <label className="field compact">
          <span>Type</span>
          <select onChange={(event) => setTypeFilter(event.target.value)} value={typeFilter}>
            <option value="all">All types</option>
            {types.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>

        <label className="field compact">
          <span>Role</span>
          <select onChange={(event) => setRoleFilter(event.target.value)} value={roleFilter}>
            <option value="all">All roles</option>
            {roles.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
        </label>
      </div>

      {isEmptyDataset ? (
        <div className="empty-state">
          <h3>No relevant comments were found.</h3>
          <p>This view now stays stable even when a venue has zero confidential comments or issue reports.</p>
        </div>
      ) : null}

      {!isEmptyDataset && filteredGroups.length === 0 ? (
        <div className="empty-state">
          <h3>No comments match the current filters.</h3>
          <p>Clear the search or relax the type and role filters to widen the view.</p>
        </div>
      ) : null}

      <div className="comment-groups">
        {filteredGroups.map((group) => {
          const expanded = expandedPaperIds.has(group.paperId);
          const postCount = countComments(group.items);
          const displayTitle = (group.paperTitle || "").trim() || `Paper ${group.paperNumber}`;

          return (
            <section className="paper-thread" key={group.paperId}>
              <button
                aria-expanded={expanded}
                className="paper-thread-header paper-thread-toggle"
                onClick={() => togglePaperThread(group.paperId)}
                type="button"
              >
                <div>
                  <p className="eyebrow">Paper {group.paperNumber}</p>
                  <h3 className="paper-thread-title">{displayTitle}</h3>
                </div>
                <span className="paper-thread-summary">
                  <span>{formatPostCount(postCount)}</span>
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

function flattenRoles(comment: CommentRecord): string[] {
  return [comment.role, ...comment.children.flatMap(flattenRoles)];
}
