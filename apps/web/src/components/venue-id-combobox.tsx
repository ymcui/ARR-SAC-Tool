"use client";

import type { FocusEvent, KeyboardEvent, Ref } from "react";
import { useState } from "react";

type VenueIdComboboxProps = {
  disabled?: boolean;
  inputId: string;
  inputRef?: Ref<HTMLInputElement>;
  listboxId: string;
  name?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  recentVenueIds?: string[];
  required?: boolean;
  value: string;
};

export function VenueIdCombobox({
  disabled = false,
  inputId,
  inputRef,
  listboxId,
  name,
  onChange,
  placeholder = "EMNLP/2026/Conference",
  recentVenueIds = [],
  required = false,
  value
}: VenueIdComboboxProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeRecentIndex, setActiveRecentIndex] = useState(-1);
  const uniqueRecentVenueIds = recentVenueIds.filter(
    (recentVenueId, index, venueIds) =>
      recentVenueId.trim() && venueIds.indexOf(recentVenueId) === index
  );
  const normalizedValue = value.trim().toLowerCase();
  const matchingRecentVenueIds = uniqueRecentVenueIds.filter((recentVenueId) =>
    normalizedValue ? recentVenueId.toLowerCase().includes(normalizedValue) : true
  );
  const showRecentVenueIds = isOpen && matchingRecentVenueIds.length > 0 && !disabled;

  function closeRecentVenues() {
    setIsOpen(false);
    setActiveRecentIndex(-1);
  }

  function selectRecentVenue(recentVenueId: string) {
    onChange(recentVenueId);
    closeRecentVenues();
  }

  function handleBlur(event: FocusEvent<HTMLInputElement>) {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof HTMLElement && nextTarget.closest(`#${listboxId}`)) {
      return;
    }
    closeRecentVenues();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape" && showRecentVenueIds) {
      event.stopPropagation();
      event.preventDefault();
      closeRecentVenues();
      return;
    }

    if (matchingRecentVenueIds.length === 0 || disabled) {
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setIsOpen(true);
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
    <div className="venue-field">
      <input
        aria-activedescendant={
          showRecentVenueIds && activeRecentIndex >= 0
            ? `${listboxId}-option-${activeRecentIndex}`
            : undefined
        }
        aria-autocomplete="list"
        aria-controls={showRecentVenueIds ? listboxId : undefined}
        aria-expanded={showRecentVenueIds}
        autoComplete="off"
        disabled={disabled}
        id={inputId}
        name={name}
        onBlur={handleBlur}
        onChange={(event) => {
          onChange(event.target.value);
          setIsOpen(true);
          setActiveRecentIndex(-1);
        }}
        onClick={() => {
          setIsOpen(true);
          setActiveRecentIndex(-1);
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        ref={inputRef}
        required={required}
        role="combobox"
        spellCheck={false}
        type="text"
        value={value}
      />
      {showRecentVenueIds ? (
        <div className="recent-venues-list" id={listboxId} role="listbox">
          {matchingRecentVenueIds.map((recentVenueId, recentVenueIndex) => (
            <button
              aria-selected={
                activeRecentIndex >= 0
                  ? recentVenueIndex === activeRecentIndex
                  : recentVenueId === value
              }
              className="recent-venue-option"
              id={`${listboxId}-option-${recentVenueIndex}`}
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
  );
}
