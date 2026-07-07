"use client";

import { FormEvent, useState } from "react";

import { formatLastSync, joinClasses } from "@/lib/format";
import type { DashboardLoadProgress, ViewerInfo } from "@/lib/types";

type VenueWorkspacePanelProps = {
  viewer: ViewerInfo | null;
  venueId: string;
  recentVenueIds?: string[];
  lastSyncedAt?: string;
  stats?: {
    papers: number;
    areaChairs: number;
  };
  loadProgress: DashboardLoadProgress | null;
  isBusy: boolean;
  onVenueIdChange: (value: string) => void;
  onLoadOrRefresh: () => void;
};

const RECENT_VENUES_LISTBOX_ID = "recent-venue-ids";

function formatProgressLabel(progress: DashboardLoadProgress) {
  if (progress.error) {
    return "Failed";
  }

  if (progress.total > 0) {
    return `${Math.min(progress.current, progress.total)}/${progress.total}`;
  }
  return progress.done ? "Done" : "Working";
}

function formatPhase(phase: string) {
  switch (phase) {
    case "venue":
      return "Venue";
    case "submissions":
      return "Submissions";
    case "scope":
      return "SAC scope";
    case "papers":
      return "Paper scan";
    case "groups":
      return "Assignment groups";
    case "build":
      return "Workspace build";
    case "ready":
      return "Ready";
    case "error":
      return "Error";
    default:
      return phase;
  }
}

export function VenueWorkspacePanel({
  viewer,
  venueId,
  recentVenueIds = [],
  lastSyncedAt,
  stats,
  loadProgress,
  isBusy,
  onVenueIdChange,
  onLoadOrRefresh
}: VenueWorkspacePanelProps) {
  const [isRecentOpen, setIsRecentOpen] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsRecentOpen(false);
    onLoadOrRefresh();
  }

  const showLoadProgress = loadProgress && (!loadProgress.done || Boolean(loadProgress.error));
  const uniqueRecentVenueIds = recentVenueIds.filter(
    (recentVenueId, index, venueIds) => recentVenueId.trim() && venueIds.indexOf(recentVenueId) === index
  );
  const showRecentVenueIds = isRecentOpen && uniqueRecentVenueIds.length > 0 && !isBusy;

  return (
    <section className="command-panel workspace-panel workspace-panel-compact">
      <div className="workspace-panel-header">
        <p className="eyebrow">Venue ID</p>
      </div>

      <form className="workspace-panel-form" onSubmit={handleSubmit}>
        <div className="field venue-field">
          <input
            aria-controls={showRecentVenueIds ? RECENT_VENUES_LISTBOX_ID : undefined}
            aria-expanded={showRecentVenueIds}
            aria-label="Venue ID"
            autoComplete="off"
            disabled={isBusy}
            onBlur={() => setIsRecentOpen(false)}
            onChange={(event) => onVenueIdChange(event.target.value)}
            onFocus={() => setIsRecentOpen(true)}
            placeholder="aclweb.org/ACL/ARR/2026/March"
            role="combobox"
            spellCheck={false}
            value={venueId}
          />
          {showRecentVenueIds ? (
            <div className="recent-venues-list" id={RECENT_VENUES_LISTBOX_ID} role="listbox">
              {uniqueRecentVenueIds.map((recentVenueId) => (
                <button
                  aria-selected={recentVenueId === venueId}
                  className="recent-venue-option"
                  key={recentVenueId}
                  onClick={() => {
                    onVenueIdChange(recentVenueId);
                    setIsRecentOpen(false);
                  }}
                  onMouseDown={(event) => event.preventDefault()}
                  role="option"
                  type="button"
                >
                  {recentVenueId}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="workspace-panel-actions">
          <button className="primary-button" disabled={!viewer || !venueId.trim() || isBusy} type="submit">
            Load / Refresh
          </button>
          <span className={joinClasses("status-chip", viewer ? "positive" : "muted")}>
            {viewer ? `Logged in as ${viewer.fullname}` : "Login required"}
          </span>
          <span className="status-chip muted">{`Last sync: ${formatLastSync(lastSyncedAt)}`}</span>
        </div>

        {stats ? (
          <div aria-label="Venue summary" className="workspace-panel-stats">
            <div className="workspace-stat-card">
              <span>Paper #</span>
              <strong>{stats.papers}</strong>
            </div>
            <div className="workspace-stat-card">
              <span>AC #</span>
              <strong>{stats.areaChairs}</strong>
            </div>
          </div>
        ) : null}
      </form>

      {showLoadProgress ? (
        <div
          aria-live="polite"
          className={joinClasses("load-progress", loadProgress.error ? "error" : undefined)}
        >
          <div className="load-progress-header">
            <span className="section-caption">{formatPhase(loadProgress.phase)}</span>
            <strong>{formatProgressLabel(loadProgress)}</strong>
          </div>
          <p className="load-progress-message">{loadProgress.message}</p>
          <div
            aria-hidden="true"
            className={joinClasses(
              "load-progress-track",
              loadProgress.total > 0 ? undefined : "indeterminate"
            )}
          >
            <span
              className={joinClasses(
                "load-progress-fill",
                loadProgress.error ? "error" : undefined,
                loadProgress.total > 0 ? undefined : "indeterminate"
              )}
              style={
                loadProgress.total > 0
                  ? {
                      width: `${Math.max(
                        6,
                        Math.min(100, (loadProgress.current / loadProgress.total) * 100)
                      )}%`
                    }
                  : undefined
              }
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}
