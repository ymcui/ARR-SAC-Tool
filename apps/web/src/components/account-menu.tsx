"use client";

import { FocusEvent, FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";

import type { ViewerInfo } from "@/lib/types";

type AccountMenuProps = {
  viewer: ViewerInfo;
  venueId: string;
  recentVenueIds?: string[];
  isBusy: boolean;
  isLoadingDashboard: boolean;
  isLoggingOut: boolean;
  onLoadOrRefresh: (venueId: string) => void;
  onLogout: () => void;
};

const ACCOUNT_POPOVER_ID = "account-venue-popover";
const VENUE_INPUT_ID = "account-venue-id";
const RECENT_VENUES_LISTBOX_ID = "account-recent-venue-ids";

export function AccountMenu({
  viewer,
  venueId,
  recentVenueIds = [],
  isBusy,
  isLoadingDashboard,
  isLoggingOut,
  onLoadOrRefresh,
  onLogout
}: AccountMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [venueDraft, setVenueDraft] = useState(venueId);
  const [isRecentOpen, setIsRecentOpen] = useState(false);
  const [activeRecentIndex, setActiveRecentIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const venueInputRef = useRef<HTMLInputElement>(null);
  const logoutRef = useRef<HTMLButtonElement>(null);

  const uniqueRecentVenueIds = recentVenueIds.filter(
    (recentVenueId, index, venueIds) => recentVenueId.trim() && venueIds.indexOf(recentVenueId) === index
  );
  const normalizedVenueDraft = venueDraft.trim().toLowerCase();
  const matchingRecentVenueIds = uniqueRecentVenueIds.filter((recentVenueId) =>
    normalizedVenueDraft ? recentVenueId.toLowerCase().includes(normalizedVenueDraft) : true
  );
  const showRecentVenueIds = isOpen && isRecentOpen && matchingRecentVenueIds.length > 0 && !isBusy;
  const viewerName = viewer.fullname.trim() || viewer.id;

  useEffect(() => {
    setVenueDraft(venueId);
  }, [venueId]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    if (venueInputRef.current && !venueInputRef.current.disabled) {
      venueInputRef.current.focus();
    } else if (logoutRef.current && !logoutRef.current.disabled) {
      logoutRef.current.focus();
    } else {
      popoverRef.current?.focus();
    }

    function handlePointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) {
        setIsOpen(false);
        setIsRecentOpen(false);
        setActiveRecentIndex(-1);
      }
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      setIsOpen(false);
      setIsRecentOpen(false);
      setActiveRecentIndex(-1);
      triggerRef.current?.focus();
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  function handleAccountBlur(event: FocusEvent<HTMLDivElement>) {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && containerRef.current?.contains(nextTarget)) {
      return;
    }
    setIsOpen(false);
    closeRecentVenues();
  }

  function closeRecentVenues() {
    setIsRecentOpen(false);
    setActiveRecentIndex(-1);
  }

  function closeAccountMenu() {
    setIsOpen(false);
    closeRecentVenues();
    triggerRef.current?.focus();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedVenueId = venueDraft.trim();
    if (!trimmedVenueId || isBusy) {
      return;
    }
    closeAccountMenu();
    onLoadOrRefresh(trimmedVenueId);
  }

  function selectRecentVenue(recentVenueId: string) {
    setVenueDraft(recentVenueId);
    closeRecentVenues();
  }

  function handleVenueBlur(event: FocusEvent<HTMLInputElement>) {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof HTMLElement && nextTarget.closest(`#${RECENT_VENUES_LISTBOX_ID}`)) {
      return;
    }
    closeRecentVenues();
  }

  function handleVenueKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape" && showRecentVenueIds) {
      event.stopPropagation();
      event.preventDefault();
      closeRecentVenues();
      return;
    }

    if (matchingRecentVenueIds.length === 0 || isBusy) {
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setIsRecentOpen(true);
      setActiveRecentIndex((currentIndex) => {
        if (event.key === "ArrowDown") {
          return currentIndex >= matchingRecentVenueIds.length - 1 ? 0 : currentIndex + 1;
        }
        return currentIndex <= 0 ? matchingRecentVenueIds.length - 1 : currentIndex - 1;
      });
      return;
    }

    if (event.key === "Enter" && showRecentVenueIds && activeRecentIndex >= 0) {
      event.preventDefault();
      selectRecentVenue(matchingRecentVenueIds[activeRecentIndex]);
    }
  }

  return (
    <div className="account-menu" onBlur={handleAccountBlur} ref={containerRef}>
      <button
        aria-controls={isOpen ? ACCOUNT_POPOVER_ID : undefined}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        className="account-menu-trigger"
        onClick={() => {
          setIsOpen((current) => !current);
          closeRecentVenues();
        }}
        ref={triggerRef}
        type="button"
      >
        <span className="account-menu-name" title={viewerName}>{viewerName}</span>
        <svg aria-hidden="true" viewBox="0 0 16 16">
          <path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" />
        </svg>
      </button>

      {isOpen ? (
        <section
          aria-label="Account and venue settings"
          className="account-menu-popover"
          id={ACCOUNT_POPOVER_ID}
          ref={popoverRef}
          role="dialog"
          tabIndex={-1}
        >
          <form className="account-menu-form" onSubmit={handleSubmit}>
            <div className="field">
              <label htmlFor={VENUE_INPUT_ID}>
                <span>Venue ID</span>
              </label>
              <div className="venue-field">
                <input
                  aria-activedescendant={
                    showRecentVenueIds && activeRecentIndex >= 0
                      ? `${RECENT_VENUES_LISTBOX_ID}-option-${activeRecentIndex}`
                      : undefined
                  }
                  aria-autocomplete="list"
                  aria-controls={showRecentVenueIds ? RECENT_VENUES_LISTBOX_ID : undefined}
                  aria-expanded={showRecentVenueIds}
                  autoComplete="off"
                  disabled={isBusy}
                  id={VENUE_INPUT_ID}
                  onBlur={handleVenueBlur}
                  onChange={(event) => {
                    setVenueDraft(event.target.value);
                    setActiveRecentIndex(-1);
                  }}
                  onClick={() => {
                    setIsRecentOpen(true);
                    setActiveRecentIndex(-1);
                  }}
                  onKeyDown={handleVenueKeyDown}
                  placeholder="aclweb.org/ACL/ARR/2026/May"
                  ref={venueInputRef}
                  role="combobox"
                  spellCheck={false}
                  value={venueDraft}
                />
                {showRecentVenueIds ? (
                  <div className="recent-venues-list" id={RECENT_VENUES_LISTBOX_ID} role="listbox">
                    {matchingRecentVenueIds.map((recentVenueId, recentVenueIndex) => (
                      <button
                        aria-selected={
                          activeRecentIndex >= 0
                            ? recentVenueIndex === activeRecentIndex
                            : recentVenueId === venueDraft
                        }
                        className="recent-venue-option"
                        id={`${RECENT_VENUES_LISTBOX_ID}-option-${recentVenueIndex}`}
                        key={recentVenueId}
                        onClick={() => selectRecentVenue(recentVenueId)}
                        onMouseDown={(event) => event.preventDefault()}
                        role="option"
                        tabIndex={-1}
                        type="button"
                      >
                        {recentVenueId}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            <button className="primary-button account-menu-load" disabled={!venueDraft.trim() || isBusy} type="submit">
              {isLoadingDashboard ? "Loading..." : "Load / Refresh"}
            </button>
          </form>

          <div className="account-menu-divider" />

          <button
            className="account-menu-logout"
            disabled={isLoggingOut}
            onClick={onLogout}
            ref={logoutRef}
            type="button"
          >
            {isLoggingOut ? "Logging out..." : "Logout"}
          </button>
        </section>
      ) : null}
    </div>
  );
}
