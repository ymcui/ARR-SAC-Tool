"use client";

import { AccountMenu } from "@/components/account-menu";
import { VersionUpdateNotice } from "@/components/version-update-notice";
import { formatLastSync, joinClasses } from "@/lib/format";
import type { TabKey, VenueStage, ViewerInfo } from "@/lib/types";

type ToolbarProps = {
  viewer: ViewerInfo | null;
  venueId: string;
  recentVenueIds: string[];
  lastSyncedAt?: string;
  isBusy: boolean;
  isLoadingDashboard: boolean;
  isLoggingOut: boolean;
  onLogout: () => void;
  onLoadOrRefresh: (venueId: string) => void;
  tabs: Array<{ key: TabKey; label: string }>;
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
  showTabs: boolean;
  venueStage: VenueStage;
};

export function Toolbar({
  viewer,
  venueId,
  recentVenueIds,
  lastSyncedAt,
  isBusy,
  isLoadingDashboard,
  isLoggingOut,
  onLogout,
  onLoadOrRefresh,
  tabs,
  activeTab,
  onTabChange,
  showTabs,
  venueStage
}: ToolbarProps) {
  const contextStatus = lastSyncedAt ? `Last sync: ${formatLastSync(lastSyncedAt)}` : null;

  return (
    <div className="toolbar-shell">
      <div className="toolbar-meta">
        <div className="brand-lockup">
          <span aria-hidden="true" className="brand-mark">
            <svg className="brand-mark-icon" viewBox="0 0 64 64">
              <path
                d="M18 12h21l9 9v23a8 8 0 0 1-8 8H18a8 8 0 0 1-8-8V20a8 8 0 0 1 8-8Z"
                fill="rgba(255,255,255,0.92)"
                stroke="rgba(36,74,179,0.18)"
                strokeWidth="2.6"
              />
              <path d="M39 12v10h10" fill="none" stroke="var(--accent-2)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.6" />
              <path d="M19 28h18" fill="none" stroke="rgba(36,74,179,0.26)" strokeLinecap="round" strokeWidth="2.6" />
              <path d="M19 35h14" fill="none" stroke="rgba(36,74,179,0.22)" strokeLinecap="round" strokeWidth="2.6" />
              <path d="M19 42h10" fill="none" stroke="rgba(36,74,179,0.18)" strokeLinecap="round" strokeWidth="2.6" />
              <circle cx="44" cy="43" fill="#ffffff" r="8.5" stroke="var(--accent-strong)" strokeWidth="2.8" />
              <path
                d="M40 43.5l2.8 2.9 5.2-6.1"
                fill="none"
                stroke="var(--accent-strong)"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="3"
              />
            </svg>
          </span>

          <div className="brand-copy">
            <p className="eyebrow">ACL Rolling Review</p>
            <div className="brand-title-row">
              <h1>SAC Monitor</h1>
              <div className="brand-venue-context">
                <span className={joinClasses("status-chip", venueStage === "ARR Stage" ? "arr-stage" : "commitment-stage")}>
                  {venueStage}
                </span>
                {contextStatus ? (
                  <span className="toolbar-sync-info">
                    {contextStatus}
                  </span>
                ) : null}
              </div>
              <VersionUpdateNotice />
            </div>
          </div>
        </div>

      </div>

      <div className="toolbar-utility">
        {showTabs ? (
          <nav className="tab-strip toolbar-tab-strip" role="tablist">
            {tabs.map((tab) => (
              <button
                aria-selected={activeTab === tab.key}
                className={joinClasses("tab-button", activeTab === tab.key && "active")}
                key={tab.key}
                onClick={() => onTabChange(tab.key)}
                role="tab"
                type="button"
              >
                {tab.label}
              </button>
            ))}
          </nav>
        ) : null}
        {viewer ? (
          <AccountMenu
            isBusy={isBusy}
            isLoadingDashboard={isLoadingDashboard}
            isLoggingOut={isLoggingOut}
            onLoadOrRefresh={onLoadOrRefresh}
            onLogout={onLogout}
            recentVenueIds={recentVenueIds}
            venueId={venueId}
            viewer={viewer}
          />
        ) : null}
      </div>
    </div>
  );
}
