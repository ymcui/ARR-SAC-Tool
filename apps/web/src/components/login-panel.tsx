"use client";

import { FormEvent, useState } from "react";

type LoginPanelProps = {
  isBusy: boolean;
  error: string | null;
  venueId: string;
  onVenueIdChange: (value: string) => void;
  onLogin: (username: string, password: string, venueId: string) => Promise<void>;
};

export function LoginPanel({
  isBusy,
  error,
  venueId,
  onVenueIdChange,
  onLogin
}: LoginPanelProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    try {
      await onLogin(username.trim(), password, venueId.trim());
    } finally {
      setPassword("");
    }
  }

  return (
    <section
      aria-busy={isBusy}
      aria-labelledby="login-panel-title"
      className="login-panel"
    >
      <div className="login-panel-intro">
        <div className="login-panel-primary">
          <span aria-hidden="true" className="login-panel-mark">
            <svg viewBox="0 0 36 36">
              <rect fill="none" height="27" rx="6" stroke="currentColor" strokeWidth="2" width="25" x="5.5" y="4.5" />
              <path d="M11 12h14M11 17h9" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
              <circle cx="24.5" cy="24" fill="currentColor" r="5.5" />
              <path d="m22.1 24 1.6 1.7 3.2-3.7" fill="none" stroke="#fff" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
            </svg>
          </span>

          <div className="login-panel-body">
            <div className="login-panel-header">
              <p className="eyebrow">OpenReview login</p>
              <h2 id="login-panel-title">Sign in</h2>
            </div>

            <p className="login-panel-copy">
              Enter your OpenReview credentials and venue ID to open the SAC workspace in one step.
            </p>
          </div>
        </div>

        <div aria-hidden="true" className="login-panel-flow">
          <span><strong>1</strong> Authenticate</span>
          <span><strong>2</strong> Load venue</span>
        </div>
      </div>

      <form className="login-form" onSubmit={handleSubmit}>
        <div className="login-form-fields">
          <label className="field">
            <span>OpenReview email</span>
            <input
              autoComplete="username"
              disabled={isBusy}
              name="username"
              onChange={(event) => setUsername(event.target.value)}
              placeholder="you@example.com"
              required
              type="email"
              value={username}
            />
          </label>

          <label className="field">
            <span>Password</span>
            <input
              autoComplete="current-password"
              disabled={isBusy}
              name="password"
              onChange={(event) => setPassword(event.target.value)}
              placeholder="OpenReview password"
              required
              type="password"
              value={password}
            />
          </label>

          <label className="field">
            <span>Venue ID</span>
            <input
              autoComplete="off"
              disabled={isBusy}
              name="venueId"
              onChange={(event) => onVenueIdChange(event.target.value)}
              placeholder="aclweb.org/ACL/ARR/2026/May"
              required
              spellCheck={false}
              type="text"
              value={venueId}
            />
          </label>
        </div>

        <div className="login-form-actions">
          <button className="primary-button login-submit" disabled={isBusy} type="submit">
            {isBusy ? "Signing in & loading..." : "Sign in & load venue"}
          </button>

          <p className="login-security-note">
            <svg aria-hidden="true" viewBox="0 0 20 20">
              <rect fill="none" height="9" rx="2.2" stroke="currentColor" strokeWidth="1.6" width="12" x="4" y="8" />
              <path d="M6.8 8V6.2a3.2 3.2 0 0 1 6.4 0V8" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
              <circle cx="10" cy="12.5" fill="currentColor" r="1" />
            </svg>
            <span>Credentials are sent to the official OpenReview API over HTTPS.</span>
          </p>

          {error ? <p className="error-banner compact">{error}</p> : null}
        </div>
      </form>
    </section>
  );
}
