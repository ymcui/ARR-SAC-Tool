"use client";

import { useId } from "react";

export function EmptyStateIcon() {
  const idPrefix = useId().replaceAll(":", "");
  const borderGradId = `${idPrefix}-empty-border-grad`;
  const boxFillId = `${idPrefix}-empty-box-fill`;
  const flapFillId = `${idPrefix}-empty-flap-fill`;
  const leafFillId = `${idPrefix}-empty-leaf-fill`;
  const boxShadowId = `${idPrefix}-empty-box-shadow`;

  return (
    <svg
      aria-hidden="true"
      className="empty-state-icon"
      focusable="false"
      viewBox="0 0 402 386"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={borderGradId} x1="45" y1="27" x2="352" y2="352" gradientUnits="userSpaceOnUse">
          <stop stopColor="#DCE8FF" />
          <stop offset="0.5" stopColor="#EDF4FF" />
          <stop offset="1" stopColor="#E2EDFF" />
        </linearGradient>

        <linearGradient id={boxFillId} x1="150" y1="185" x2="249" y2="282" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FCFDFF" />
          <stop offset="1" stopColor="#EEF5FF" />
        </linearGradient>

        <linearGradient id={flapFillId} x1="107" y1="184" x2="286" y2="227" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FCFDFF" />
          <stop offset="1" stopColor="#F1F6FF" />
        </linearGradient>

        <linearGradient id={leafFillId} x1="205" y1="107" x2="262" y2="151" gradientUnits="userSpaceOnUse">
          <stop stopColor="#E8F7FF" stopOpacity="0.85" />
          <stop offset="1" stopColor="#FBFEFF" stopOpacity="0.72" />
        </linearGradient>

        <radialGradient
          id={boxShadowId}
          cx="0"
          cy="0"
          r="1"
          gradientUnits="userSpaceOnUse"
          gradientTransform="translate(197 264) rotate(90) scale(31 85)"
        >
          <stop stopColor="#8095D2" stopOpacity="0.16" />
          <stop offset="0.62" stopColor="#B7C7ED" stopOpacity="0.08" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect
        x="26.5"
        y="20.5"
        width="339"
        height="339"
        rx="52.5"
        fill="#FFFFFF"
        stroke={`url(#${borderGradId})`}
        strokeWidth="2.6"
      />

      <g stroke="#C3D2F3" strokeWidth="3.5" fill="#FFFFFF" opacity="0.88">
        <circle cx="138.2" cy="98.6" r="3.1" />
        <circle cx="111.0" cy="134.9" r="3.2" />
      </g>

      <g
        stroke="#B7C8ED"
        strokeWidth="4.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        opacity="0.88"
      >
        <path d="M126.0 139.4H158.6" />
        <path d="M162.2 124.2C170.3 124.2 176.0 129.5 176.0 136.4C176.0 145.0 166.5 149.3 158.9 146.2" />
        <path d="M106.8 157.7H148.0C159.8 157.7 168.5 158.9 171.0 168.0C172.7 174.4 167.7 178.1 160.7 175.5" />
        <path d="M174.1 158.2H202.1" />
      </g>

      <g
        stroke="#7EA2F1"
        strokeWidth="3.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill={`url(#${leafFillId})`}
      >
        <path d="M207.2 146.2C209.3 126.7 221.9 112.5 238.4 106.6C237.2 123.6 226.1 139.2 207.2 146.2Z" />
        <path d="M208.8 144.0C219.1 133.6 229.0 119.7 237.9 107.2" fill="none" />
        <path d="M237.6 143.6C245.8 136.3 256.4 136.1 263.0 142.7C256.0 150.3 245.1 150.8 237.6 143.6Z" />
      </g>

      <path d="M104.7 267.3H288.7" stroke="#D9E5FA" strokeWidth="3.1" strokeLinecap="round" />
      <ellipse cx="197.2" cy="263.6" rx="82" ry="29" fill={`url(#${boxShadowId})`} />

      <g stroke="#768AC4" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M127.4 184.0L196.0 174.4L264.6 184.0L196.0 195.2Z" fill="#F8FBFF" fillOpacity="0.66" />
        <path d="M128.0 218.6V258.6C128.0 264.0 132.1 267.7 137.8 269.0L196.0 282.0V238.3L128.0 218.6Z" fill={`url(#${boxFillId})`} />
        <path d="M196.0 238.3V282.0L254.2 269.0C260.0 267.7 264.0 264.0 264.0 258.6V218.6L196.0 238.3Z" fill={`url(#${boxFillId})`} />
        <path d="M127.4 184.0L105.2 217.3L175.0 226.2L196.0 195.2L127.4 184.0Z" fill={`url(#${flapFillId})`} />
        <path d="M264.6 184.0L286.8 217.3L217.0 226.2L196.0 195.2L264.6 184.0Z" fill={`url(#${flapFillId})`} />
        <path d="M196.0 174.4V195.2" fill="none" />
        <path d="M196.0 195.2V282.0" fill="none" />
        <path d="M128.0 218.6L196.0 238.3L264.0 218.6" fill="none" />
      </g>
    </svg>
  );
}
