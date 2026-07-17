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

export function formatLoadPhase(phase: string) {
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
  const isTerminal = progress.done || Boolean(progress.error);
  const progressValue =
    progress.total > 0 ? Math.max(0, Math.min(progress.current, progress.total)) : undefined;
  const progressWidth =
    progress.total > 0
      ? `${Math.max(6, Math.min(100, (progress.current / progress.total) * 100))}%`
      : progress.error
        ? "0%"
        : progress.done
          ? "100%"
          : undefined;
  const phaseLabel = formatLoadPhase(progress.phase);

  return (
    <section
      aria-label="Venue loading progress"
      className={joinClasses("load-progress", progress.error ? "error" : undefined)}
    >
      <div className="load-progress-header">
        <span className="section-caption">{phaseLabel}</span>
        <strong>{formatProgressLabel(progress)}</strong>
      </div>
      <p className="load-progress-message">{progress.message}</p>
      <div
        aria-hidden={isTerminal || undefined}
        aria-label={!isTerminal ? "Venue load progress" : undefined}
        aria-valuemax={!isTerminal && progress.total > 0 ? progress.total : undefined}
        aria-valuemin={!isTerminal && progress.total > 0 ? 0 : undefined}
        aria-valuenow={!isTerminal ? progressValue : undefined}
        aria-valuetext={
          !isTerminal && progressValue !== undefined
            ? `${progressValue} of ${progress.total}`
            : undefined
        }
        className={joinClasses("load-progress-track", isIndeterminate ? "indeterminate" : undefined)}
        role={!isTerminal ? "progressbar" : undefined}
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
      {progress.error ? (
        <p aria-atomic="true" className="sr-only" role="alert">
          Venue loading failed. {progress.message}
        </p>
      ) : null}
    </section>
  );
}
