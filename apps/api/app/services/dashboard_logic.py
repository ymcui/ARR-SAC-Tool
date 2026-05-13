from __future__ import annotations

import logging
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone
from typing import Any, Callable, Dict, Iterable, List, Optional

from app.schemas import (
    AnalyticsInfo,
    AreaChairRecord,
    CommentGroup,
    CommentRecord,
    DashboardResponse,
    DistributionPoint,
    HistogramPoint,
    PaperRecord,
    ScatterPoint,
    ScoreSummary,
    SummaryInfo,
    VenueInfo,
    ViewerInfo,
    WithdrawnPaperRecord,
)

OPENREVIEW_FORUM_URL = "https://openreview.net/forum?id={paper_id}"
OPENREVIEW_NOTE_URL = "https://openreview.net/forum?id={forum_id}&noteId={note_id}"
ARR_STAGE_PREFIX = "aclweb.org/ACL/ARR"
ProgressCallback = Callable[[str, str, int, int], None]
logger = logging.getLogger(__name__)


def _model_validate(model_cls, payload: dict):
    if hasattr(model_cls, "model_validate"):
        return model_cls.model_validate(payload)
    return model_cls.parse_obj(payload)


def build_dashboard_response(
    snapshot: Dict[str, Any],
    venue_id: str,
    progress_callback: ProgressCallback | None = None,
) -> DashboardResponse:
    build_started_at = time.perf_counter()
    viewer = _model_validate(ViewerInfo, snapshot.get("viewer", {}))
    submission_name = str(snapshot.get("submission_name", "Submission"))
    my_sac_groups = set(snapshot.get("my_sac_groups", []))
    submissions = snapshot.get("submissions", [])
    withdrawn_submissions = snapshot.get("withdrawn_submissions", [])
    area_chair_contacts = snapshot.get("area_chair_contacts", {})

    papers: List[PaperRecord] = []
    withdrawn_papers: List[WithdrawnPaperRecord] = []
    comment_entries: List[Dict[str, Any]] = []
    scanned_replies = 0

    if progress_callback:
        progress_callback("build", "Normalizing paper records...", 0, len(submissions))

    normalize_started_at = time.perf_counter()
    for index, submission in enumerate(submissions, start=1):
        if progress_callback:
            progress_callback(
                "build",
                f"Normalizing submission {submission.get('number', index)} into dashboard rows...",
                index,
                len(submissions),
            )
        if not _belongs_to_sac_batch(submission, my_sac_groups):
            continue
        if _is_withdrawn(submission) or _is_desk_rejected(submission):
            continue

        area_chairs = submission.get("area_chairs") or []
        if not area_chairs:
            continue

        paper = _build_paper_record(submission, area_chairs[0])
        papers.append(paper)
        scanned_replies += len(submission.get("replies", []) or [])
        comment_entries.extend(_collect_comment_entries(submission))

    for submission in withdrawn_submissions:
        if not _belongs_to_sac_batch(submission, my_sac_groups):
            continue
        if not _is_withdrawn(submission):
            continue
        withdrawn_papers.append(_build_withdrawn_paper_record(submission))

    withdrawn_papers.sort(key=lambda item: item.paperNumber)
    logger.warning(
        (
            "Dashboard build phase normalize_papers completed in %.2fs for %s: "
            "submissions=%s papers=%s withdrawn_papers=%s scanned_replies=%s comment_entries=%s"
        ),
        time.perf_counter() - normalize_started_at,
        viewer.id,
        len(submissions),
        len(papers),
        len(withdrawn_papers),
        scanned_replies,
        len(comment_entries),
    )

    assemble_started_at = time.perf_counter()
    papers.sort(key=lambda item: item.paperNumber)
    comment_groups = _build_comment_groups(comment_entries)
    area_chair_records = _build_area_chair_records(papers, area_chair_contacts)
    analytics = _build_analytics(papers)
    comment_count = sum(_count_comments(group.items) for group in comment_groups)
    logger.warning(
        "Dashboard build phase assemble_views completed in %.2fs for %s: ac_records=%s comment_groups=%s comments=%s",
        time.perf_counter() - assemble_started_at,
        viewer.id,
        len(area_chair_records),
        len(comment_groups),
        comment_count,
    )

    if progress_callback:
        progress_callback("build", "Assembling AC rollups, comments, and analytics...", len(submissions), len(submissions))

    response = DashboardResponse(
        viewer=viewer,
        venue=VenueInfo(
            venueId=venue_id,
            stage=_venue_stage(venue_id),
            submissionName=submission_name,
            lastSyncedAt=datetime.now(timezone.utc).isoformat(),
        ),
        summary=SummaryInfo(
            totalPapers=len(papers),
            readyPapers=sum(1 for paper in papers if paper.readyForRebuttal),
            metaReviewsDone=sum(1 for paper in papers if paper.metaReviewScore is not None),
            commentsCount=comment_count,
        ),
        papers=papers,
        areaChairs=area_chair_records,
        withdrawnPapers=withdrawn_papers,
        comments=comment_groups,
        analytics=analytics,
    )
    logger.warning(
        (
            "Dashboard response build completed in %.2fs for %s: "
            "papers=%s area_chairs=%s withdrawn_papers=%s comment_groups=%s comments=%s"
        ),
        time.perf_counter() - build_started_at,
        viewer.id,
        len(papers),
        len(area_chair_records),
        len(withdrawn_papers),
        len(comment_groups),
        comment_count,
    )
    return response


def _venue_stage(venue_id: str) -> str:
    if venue_id.startswith(ARR_STAGE_PREFIX):
        return "ARR Stage"
    return "Commitment Stage"


def _count_comments(items: List[CommentRecord]) -> int:
    total = 0
    for item in items:
        total += 1 + _count_comments(item.children)
    return total


def _belongs_to_sac_batch(submission: Dict[str, Any], my_sac_groups: set[str]) -> bool:
    return bool(set(submission.get("readers", [])) & my_sac_groups)


def _is_withdrawn(submission: Dict[str, Any]) -> bool:
    content = submission.get("content", {})
    withdrawal = _content_text(content.get("withdrawal_confirmation"))
    if withdrawal.strip():
        return True
    venue_value = _content_text(content.get("venue")).lower()
    return "withdrawn" in venue_value


def _withdrawn_status(content: Dict[str, Any]) -> str:
    withdrawal = _content_text(content.get("withdrawal_confirmation")).strip()
    if withdrawal:
        return withdrawal

    venue_value = _content_text(content.get("venue")).strip()
    if venue_value:
        return venue_value

    return "Withdrawn"


def _is_desk_rejected(submission: Dict[str, Any]) -> bool:
    venue_value = _content_text(submission.get("content", {}).get("venue")).lower()
    return "desk rejected" in venue_value


def _build_paper_record(submission: Dict[str, Any], area_chair: str) -> PaperRecord:
    replies = submission.get("replies", []) or []

    completed_reviews = 0
    confidence_scores: List[float] = []
    soundness_scores: List[float] = []
    excitement_scores: List[float] = []
    overall_scores: List[float] = []
    meta_review_score: Optional[float] = None
    author_responses = 0
    has_ac_checklist = False
    has_confidential = False
    has_issue_report = False
    meta_review_text = ""

    for reply in replies:
        if _is_actual_review(reply):
            completed_reviews += 1
            _append_if_present(confidence_scores, _content_number(reply.get("content", {}), "confidence"))
            _append_if_present(soundness_scores, _content_number(reply.get("content", {}), "soundness"))
            _append_if_present(excitement_scores, _content_number(reply.get("content", {}), "excitement"))
            _append_if_present(
                overall_scores,
                _content_number(reply.get("content", {}), "overall_assessment"),
            )

        if meta_review_score is None and _is_meta_review(reply):
            meta_review_score = _first_number(
                reply.get("content", {}),
                ["overall_assessment", "overall_rating", "score"],
            )

        if not meta_review_text and _is_meta_review(reply):
            meta_review_text = _extract_meta_review_text(reply)

        if _is_author_response(reply):
            author_responses += 1

        if _is_action_editor_checklist(reply):
            has_ac_checklist = True

        if _is_confidential_comment(reply):
            has_confidential = True

        if _is_issue_report(reply):
            has_issue_report = True

    expected_reviews = len(submission.get("reviewers") or [])
    paper_id = str(submission.get("id"))
    content = submission.get("content", {})

    return PaperRecord(
        paperNumber=int(submission.get("number")),
        paperId=paper_id,
        paperTitle=_paper_title(content, int(submission.get("number"))),
        paperType=_content_text(content.get("paper_type")),
        areaChair=area_chair,
        completedReviews=completed_reviews,
        expectedReviews=expected_reviews,
        readyForRebuttal=completed_reviews >= 3,
        authorResponseReady=author_responses >= 3,
        acChecklistReady=has_ac_checklist,
        resubmission=_has_previous_url(content),
        preprint=_first_content_bool(
            content,
            [
                "preprint",
                "Preprint",
                "pre_print",
                "Pre-print",
                "pre-print",
                "has_preprint",
                "has preprint",
                "Has preprint",
            ],
        ),
        hasConfidential=has_confidential,
        issueReport=has_issue_report,
        reviewerConfidence=_score_summary(confidence_scores),
        soundnessScore=_score_summary(soundness_scores),
        excitementScore=_score_summary(excitement_scores),
        overallAssessment=_score_summary(overall_scores),
        metaReviewScore=meta_review_score,
        metaReviewText=meta_review_text,
        responseToMetaReview=_first_content_text(
            content,
            [
                "response_to_metareview",
                "response to metareview",
                "Response to MetaReview",
                "Response to Metareview",
            ],
        ),
        forumUrl=str(submission.get("forum_url") or OPENREVIEW_FORUM_URL.format(paper_id=paper_id)),
    )


def _build_withdrawn_paper_record(submission: Dict[str, Any]) -> WithdrawnPaperRecord:
    content = submission.get("content", {})
    paper_number = int(submission.get("number"))
    paper_id = str(submission.get("id"))
    area_chairs = submission.get("area_chairs") or []

    return WithdrawnPaperRecord(
        paperNumber=paper_number,
        paperId=paper_id,
        paperTitle=_paper_title(content, paper_number),
        paperType=_content_text(content.get("paper_type")),
        areaChair=str(area_chairs[0]) if area_chairs else "",
        status=_withdrawn_status(content),
        forumUrl=OPENREVIEW_FORUM_URL.format(paper_id=paper_id),
    )


def _build_area_chair_records(
    papers: List[PaperRecord],
    area_chair_contacts: Dict[str, Dict[str, str]],
) -> List[AreaChairRecord]:
    grouped: Dict[str, Dict[str, int]] = defaultdict(
        lambda: {
            "completed": 0,
            "expected": 0,
            "ready": 0,
            "papers": 0,
            "meta": 0,
            "checklist": 0,
        }
    )

    for paper in papers:
        record = grouped[paper.areaChair]
        record["completed"] += paper.completedReviews
        record["expected"] += paper.expectedReviews
        record["ready"] += int(paper.readyForRebuttal)
        record["papers"] += 1
        record["meta"] += int(paper.metaReviewScore is not None)
        record["checklist"] += int(paper.acChecklistReady)

    results = [
        AreaChairRecord(
            areaChair=area_chair,
            areaChairName=str(area_chair_contacts.get(area_chair, {}).get("name", "")),
            areaChairEmail=str(area_chair_contacts.get(area_chair, {}).get("email", "")),
            totalCompletedReviews=values["completed"],
            totalExpectedReviews=values["expected"],
            papersReady=values["ready"],
            numPapers=values["papers"],
            allReviewsReady=values["ready"] == values["papers"] and values["papers"] > 0,
            metaReviewsDone=values["meta"],
            acChecklistDone=values["checklist"],
            allMetaReviewsReady=values["meta"] == values["papers"] and values["papers"] > 0,
        )
        for area_chair, values in sorted(grouped.items())
    ]
    return results


def _collect_comment_entries(submission: Dict[str, Any]) -> List[Dict[str, Any]]:
    entries: List[Dict[str, Any]] = []
    paper_number = int(submission.get("number"))
    paper_id = str(submission.get("id"))
    paper_title = _paper_title(submission.get("content", {}), paper_number)

    for reply in submission.get("replies", []) or []:
        if not _is_relevant_comment(reply):
            continue

        forum_id = str(reply.get("forum") or paper_id)
        note_id = str(reply.get("id", ""))
        timestamp_ms = int(reply.get("tcdate") or 0)

        entries.append(
            {
                "noteId": note_id,
                "paperNumber": paper_number,
                "paperId": paper_id,
                "paperTitle": paper_title,
                "forumUrl": OPENREVIEW_FORUM_URL.format(paper_id=paper_id),
                "type": _classify_comment_type(reply),
                "role": _infer_role(reply.get("signatures", [])),
                "date": _format_timestamp(timestamp_ms),
                "content": _extract_comment_text(reply),
                "replyTo": reply.get("replyto"),
                "link": OPENREVIEW_NOTE_URL.format(forum_id=forum_id, note_id=note_id),
                "timestampMs": timestamp_ms,
            }
        )

    return entries


def _build_comment_groups(entries: List[Dict[str, Any]]) -> List[CommentGroup]:
    if not entries:
        return []

    grouped_entries: Dict[tuple[int, str, str, str], List[Dict[str, Any]]] = defaultdict(list)
    for entry in entries:
        key = (entry["paperNumber"], entry["paperId"], entry["paperTitle"], entry["forumUrl"])
        grouped_entries[key].append(entry)

    comment_groups: List[CommentGroup] = []
    for (paper_number, paper_id, paper_title, forum_url), group_entries in sorted(grouped_entries.items()):
        ordered_entries = sorted(group_entries, key=lambda item: (item["timestampMs"], item["noteId"]))
        nodes = {
            entry["noteId"]: CommentRecord(
                noteId=entry["noteId"],
                paperNumber=entry["paperNumber"],
                paperId=entry["paperId"],
                type=entry["type"],
                role=entry["role"],
                date=entry["date"],
                content=entry["content"],
                link=entry["link"],
            )
            for entry in ordered_entries
        }

        roots: List[CommentRecord] = []
        for entry in ordered_entries:
            node = nodes[entry["noteId"]]
            parent_id = entry.get("replyTo")
            if parent_id and parent_id in nodes:
                nodes[parent_id].children.append(node)
            else:
                roots.append(node)

        comment_groups.append(
            CommentGroup(
                paperNumber=paper_number,
                paperId=paper_id,
                paperTitle=paper_title,
                forumUrl=forum_url,
                items=roots,
            )
        )

    return comment_groups


def _build_analytics(papers: List[PaperRecord]) -> AnalyticsInfo:
    edges = [1.0 + (0.5 * index) for index in range(10)]
    counts = [0 for _ in range(len(edges) - 1)]

    for paper in papers:
        average = paper.overallAssessment.average
        if average is None:
            continue
        for index in range(len(edges) - 1):
            lower_bound = edges[index]
            upper_bound = edges[index + 1]
            if lower_bound <= average < upper_bound or (
                index == len(edges) - 2 and average == upper_bound
            ):
                counts[index] += 1
                break

    histogram = [
        HistogramPoint(
            label=_overall_histogram_label(edges, index),
            center=_overall_histogram_center(edges, index),
            count=count,
        )
        for index, count in enumerate(counts)
    ]

    meta_counts = Counter(
        round(float(paper.metaReviewScore), 1)
        for paper in papers
        if paper.metaReviewScore is not None
    )
    meta_score_axis = [round(1.0 + (0.5 * index), 1) for index in range(9)]
    meta_distribution = [
        DistributionPoint(score=score, count=meta_counts.get(score, 0))
        for score in meta_score_axis
    ]

    scatter = [
        ScatterPoint(
            paperNumber=paper.paperNumber,
            paperLabel=f"Paper {paper.paperNumber}",
            areaChair=paper.areaChair,
            overallAssessment=paper.overallAssessment.average,
            metaReviewScore=paper.metaReviewScore,
        )
        for paper in papers
        if paper.overallAssessment.average is not None and paper.metaReviewScore is not None
    ]

    return AnalyticsInfo(
        overallAssessmentHistogram=histogram,
        metaReviewDistribution=meta_distribution,
        pairedScatter=scatter,
    )


def _overall_histogram_label(edges: List[float], index: int) -> str:
    if index == len(edges) - 2:
        return f"{edges[index]:.1f}"
    return f"{edges[index]:.1f}-{edges[index + 1]:.1f}"


def _overall_histogram_center(edges: List[float], index: int) -> float:
    if index == len(edges) - 2:
        return round(edges[index], 2)
    return round((edges[index] + edges[index + 1]) / 2, 2)


def _score_summary(values: List[float]) -> ScoreSummary:
    if not values:
        return ScoreSummary()
    return ScoreSummary(
        average=round(sum(values) / len(values), 2),
        values=[round(value, 2) for value in values],
    )


def _append_if_present(target: List[float], value: Optional[float]) -> None:
    if value is not None:
        target.append(value)


def _content_text(value: Any) -> str:
    if isinstance(value, dict):
        value = value.get("value", "")
    if value is None:
        return ""
    return str(value)


def _paper_title(content: Dict[str, Any], paper_number: int) -> str:
    for key in ["title", "Title", "paper_title", "submission_title"]:
        title = _content_text(content.get(key)).strip()
        if title:
            return title
    return f"Paper {paper_number}"


def _parse_number(value: Any) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)

    text = str(value).strip()
    if not text:
        return None

    token = text.split()[0]
    try:
        return float(token)
    except ValueError:
        return None


def _content_number(content: Dict[str, Any], key: str) -> Optional[float]:
    return _parse_number(content.get(key, {}).get("value") if isinstance(content.get(key), dict) else content.get(key))


def _parse_bool_text(value: str) -> bool:
    normalized = value.strip().lower()
    return normalized in {"1", "y", "checked"} or normalized.startswith(("yes", "true"))


def _first_content_bool(content: Dict[str, Any], keys: Iterable[str]) -> bool:
    for key in keys:
        text = _content_text(content.get(key)).strip()
        if text:
            return _parse_bool_text(text)
    return False


def _has_previous_url(content: Dict[str, Any]) -> bool:
    return bool(
        _first_content_text(
            content,
            [
                "Previous URL",
                "previous_url",
                "previous url",
                "previous_URL",
                "previousURL",
                "PreviousURL",
            ],
        )
    )


def _first_content_text(content: Dict[str, Any], keys: Iterable[str]) -> str:
    for key in keys:
        text = _content_text(content.get(key)).strip()
        if text:
            return text
    return ""


def _first_number(content: Dict[str, Any], keys: Iterable[str]) -> Optional[float]:
    for key in keys:
        value = _content_number(content, key)
        if value is not None:
            return value
    return None


def _is_actual_review(reply: Dict[str, Any]) -> bool:
    return any("/-/Official_Review" in invitation for invitation in reply.get("invitations", []))


def _is_meta_review(reply: Dict[str, Any]) -> bool:
    return any("/-/Meta_Review" in invitation for invitation in reply.get("invitations", []))


def _is_action_editor_checklist(reply: Dict[str, Any]) -> bool:
    return any(
        "/-/Action_Editor_Checklist" in invitation or "Action Editor Checklist" in invitation
        for invitation in reply.get("invitations", [])
    )


def _is_author_response(reply: Dict[str, Any]) -> bool:
    signatures = reply.get("signatures", [])
    if not signatures:
        return False
    return "/Authors" in signatures[0]


def _is_relevant_comment(reply: Dict[str, Any]) -> bool:
    invitations = reply.get("invitations", [])
    parts = [
        "/-/Author-Editor_Confidential_Comment",
        "/-/Comment",
        "/-/Review_Issue_Report",
    ]
    return any(part in invitation for invitation in invitations for part in parts)


def _is_confidential_comment(reply: Dict[str, Any]) -> bool:
    invitations = reply.get("invitations", [])
    return any(
        "/-/Author-Editor_Confidential_Comment" in invitation or "/-/Comment" in invitation
        for invitation in invitations
    )


def _is_issue_report(reply: Dict[str, Any]) -> bool:
    return any("/-/Review_Issue_Report" in invitation for invitation in reply.get("invitations", []))


def _extract_meta_review_text(reply: Dict[str, Any]) -> str:
    content = reply.get("content", {})
    structured_fields = [
        ("Metareview", ["metareview", "meta_review"]),
        (
            "Summary Of Reasons To Publish",
            [
                "summary_of_reasons_to_publish",
                "Summary Of Reasons To Publish",
                "summary of reasons to publish",
            ],
        ),
        (
            "Summary Of Suggested Revisions",
            [
                "summary_of_suggested_revisions",
                "Summary Of Suggested Revisions",
                "summary of suggested revisions",
            ],
        ),
    ]
    parts = []
    for label, keys in structured_fields:
        value = _first_content_text(content, keys)
        if value:
            parts.append(f"{label}:\n{value}")
    if parts:
        return "\n\n".join(parts)

    return _first_content_text(content, ["comments", "recommendation", "decision_comment", "comment"])


def _classify_comment_type(reply: Dict[str, Any]) -> str:
    invitations = reply.get("invitations", [])
    if any("/-/Review_Issue_Report" in invitation for invitation in invitations):
        return "Review Issue"
    if any("/-/Author-Editor_Confidential_Comment" in invitation for invitation in invitations):
        return "Author-Editor Confidential"
    if any("/-/Comment" in invitation for invitation in invitations):
        return "Confidential Comment"
    return "Other"


def _extract_comment_text(reply: Dict[str, Any]) -> str:
    content = reply.get("content", {})
    for key in ["comment", "justification", "text", "response", "value"]:
        if key in content:
            value = content[key]
            if isinstance(value, dict):
                value = value.get("value")
            if value is not None:
                return str(value)

    fallback = []
    for key, value in content.items():
        if isinstance(value, dict) and "value" in value:
            fallback.append(f"{key}: {value['value']}")
    return "\n".join(fallback) if fallback else "(No comment text found)"


def _infer_role(signatures: List[str]) -> str:
    if not signatures:
        return "Unknown"
    signature = signatures[0]
    if "/Authors" in signature:
        return "Author"
    if "/Reviewer" in signature:
        return "Reviewer"
    if "/Area_Chair" in signature:
        return "Area Chair"
    if "/Senior_Area_Chairs" in signature:
        return "Senior Area Chair"
    if "/Program_Chairs" in signature:
        return "Program Chair"
    if signature.startswith("~"):
        return "User"
    return "Other"


def _format_timestamp(timestamp_ms: int) -> str:
    if not timestamp_ms:
        return ""
    date = datetime.fromtimestamp(timestamp_ms / 1000, tz=timezone.utc).astimezone()
    return date.strftime("%Y-%m-%d")
