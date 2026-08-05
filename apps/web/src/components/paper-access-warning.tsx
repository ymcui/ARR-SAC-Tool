import type { PaperAccessIssue } from "@/lib/types";

type PaperAccessWarningProps = {
  issues: PaperAccessIssue[];
};

function issueDescription(reason: string) {
  if (reason === "invalid_paper_link") {
    return "The commitment has a missing or invalid Paper Link.";
  }

  return "The linked paper is not visible to this OpenReview account.";
}

export function PaperAccessWarning({ issues }: PaperAccessWarningProps) {
  if (issues.length === 0) {
    return null;
  }

  const paperLabel = issues.length === 1 ? "paper" : "papers";

  return (
    <section
      aria-labelledby="paper-access-warning-title"
      className="paper-access-warning"
      role="alert"
    >
      <div className="paper-access-warning-copy">
        <p className="eyebrow">Access warning</p>
        <h2 id="paper-access-warning-title">
          {issues.length} assigned {paperLabel} could not be loaded
        </h2>
        <p>
          All other accessible papers are shown. Ask Program Chairs to verify each Paper Link and
          ensure your OpenReview account is included in the linked paper&apos;s readers.
        </p>
      </div>

      <ul className="paper-access-warning-list">
        {issues.map((issue) => (
          <li className="paper-access-warning-item" key={`${issue.paperNumber}-${issue.reason}`}>
            <div>
              <strong>Paper {issue.paperNumber}</strong>
              <span>{issueDescription(issue.reason)}</span>
            </div>
            <div className="paper-access-warning-actions">
              <a href={issue.commitmentUrl} rel="noreferrer" target="_blank">
                Open commitment
              </a>
              {issue.forumUrl ? (
                <a href={issue.forumUrl} rel="noreferrer" target="_blank">
                  Check linked paper
                </a>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
