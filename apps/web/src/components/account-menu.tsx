"use client";

import { FocusEvent, FormEvent, useEffect, useRef, useState } from "react";

import { VenueIdCombobox } from "@/components/venue-id-combobox";
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
  const containerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const venueInputRef = useRef<HTMLInputElement>(null);
  const logoutRef = useRef<HTMLButtonElement>(null);

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
      }
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      setIsOpen(false);
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
  }

  function closeAccountMenu() {
    setIsOpen(false);
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

  return (
    <div className="account-menu" onBlur={handleAccountBlur} ref={containerRef}>
      <button
        aria-controls={isOpen ? ACCOUNT_POPOVER_ID : undefined}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        className="account-menu-trigger"
        onClick={() => {
          setIsOpen((current) => !current);
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
              <VenueIdCombobox
                disabled={isBusy}
                inputId={VENUE_INPUT_ID}
                inputRef={venueInputRef}
                listboxId={RECENT_VENUES_LISTBOX_ID}
                onChange={setVenueDraft}
                recentVenueIds={recentVenueIds}
                value={venueDraft}
              />
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
