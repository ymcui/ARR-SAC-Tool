import { joinClasses } from "@/lib/format";
import type { DashboardLoadProgress } from "@/lib/types";

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
  return (
    {
      venue: "Venue",
      submissions: "Submissions",
      scope: "SAC scope",
      replies: "Replies",
      papers: "Paper scan",
      groups: "Assignment groups",
      build: "Workspace build",
      ready: "Ready",
      error: "Error"
    }[phase] ?? phase
  );
}

export function LoadProgressPanel({ progress }: { progress: DashboardLoadProgress }) {
  const isIndeterminate = !progress.done && !progress.error && progress.total <= 0;
  const progressWidth =
    progress.total > 0
      ? `${Math.max(6, Math.min(100, (progress.current / progress.total) * 100))}%`
      : undefined;

  return (
    <section
      aria-label="Venue loading progress"
      aria-live="polite"
      className={joinClasses("load-progress", progress.error ? "error" : undefined)}
      role="status"
    >
      <div className="load-progress-header">
        <span className="section-caption">{formatPhase(progress.phase)}</span>
        <strong>{formatProgressLabel(progress)}</strong>
      </div>
      <p className="load-progress-message">{progress.message}</p>
      <div
        aria-hidden="true"
        className={joinClasses("load-progress-track", isIndeterminate ? "indeterminate" : undefined)}
      >
        <span
          className={joinClasses(
            "load-progress-fill",
            progress.error ? "error" : undefined,
            isIndeterminate ? "indeterminate" : undefined
          )}
          style={progressWidth ? { width: progressWidth } : undefined}
        />
      </div>
    </section>
  );
}
