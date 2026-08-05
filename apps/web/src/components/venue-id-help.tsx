type VenueIdHelpProps = {
  tooltipId: string;
};

export function VenueIdHelp({ tooltipId }: VenueIdHelpProps) {
  return (
    <>
      <button
        aria-describedby={tooltipId}
        aria-label="How to find the venue ID"
        className="venue-id-help-button"
        type="button"
      >
        ?
      </button>
      <span className="venue-id-help-tooltip" id={tooltipId} role="tooltip">
        The venue ID is the part of the OpenReview URL after{" "}
        <code>https://openreview.net/group?id=</code>. For example, for the ARR March 2026 venue,
        the URL is <code>https://openreview.net/group?id=aclweb.org/ACL/ARR/2026/March</code>, so
        the venue ID is <code>aclweb.org/ACL/ARR/2026/March</code>.
      </span>
    </>
  );
}
