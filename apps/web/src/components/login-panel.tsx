"use client";

import { FormEvent, MouseEvent, useEffect, useState } from "react";

type LoginPanelProps = {
  isOpen: boolean;
  isBusy: boolean;
  error: string | null;
  onClose: () => void;
  onLogin: (username: string, password: string) => Promise<void>;
};

export function LoginPanel({ isOpen, isBusy, error, onClose, onLogin }: LoginPanelProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isBusy) {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isBusy, isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onLogin(username.trim(), password);
    setPassword("");
  }

  function handleBackdropClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget && !isBusy) {
      onClose();
    }
  }

  return (
    <div className="modal-backdrop" onClick={handleBackdropClick}>
      <section aria-labelledby="login-dialog-title" aria-modal="true" className="login-panel" role="dialog">
        <div className="modal-header">
          <div>
            <p className="eyebrow">OpenReview login</p>
            <h2 id="login-dialog-title">Sign in</h2>
          </div>

          <button className="modal-close" disabled={isBusy} onClick={onClose} type="button">
            Close
          </button>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          <label className="field">
            <span>OpenReview email</span>
            <input
              autoComplete="username"
              disabled={isBusy}
              name="username"
              onChange={(event) => setUsername(event.target.value)}
              placeholder="you@example.com"
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
              type="password"
              value={password}
            />
          </label>

          <button className="primary-button login-submit" disabled={isBusy} type="submit">
            {isBusy ? "Signing in..." : "Sign in to OpenReview"}
          </button>

          {error ? <p className="error-banner compact">{error}</p> : null}
        </form>
      </section>
    </div>
  );
}
