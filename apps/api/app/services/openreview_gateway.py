from __future__ import annotations

import logging
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Callable, Dict, Iterable, List
from urllib.parse import parse_qs, urlparse

import openreview

from app.schemas import ViewerInfo

OPENREVIEW_BASE_URL = "https://api2.openreview.net"
OPENREVIEW_FORUM_URL = "https://openreview.net/forum?id={paper_id}"
ARR_STAGE_PREFIX = "aclweb.org/ACL/ARR"
MAX_COMMITMENT_LOAD_WORKERS = 8
logger = logging.getLogger(__name__)
ProgressCallback = Callable[[str, str, int, int], None]


class AuthenticationError(Exception):
    pass


class DashboardFetchError(Exception):
    pass


def _content_value(value: Any, default: str = "") -> str:
    if isinstance(value, dict):
        value = value.get("value", default)
    if value is None:
        return default
    return str(value)


def _content_text(value: Any) -> str:
    return _content_value(value, "")


def _first_content_value(content: Dict[str, Any], keys: Iterable[str], default: str = "") -> str:
    for key in keys:
        value = _content_value(content.get(key), "")
        if value.strip():
            return value
    return default


def _note_to_dict(note: Any) -> Dict[str, Any]:
    if isinstance(note, dict):
        raw = note
    else:
        raw = {
            "id": getattr(note, "id", ""),
            "forum": getattr(note, "forum", ""),
            "replyto": getattr(note, "replyto", None),
            "readers": list(getattr(note, "readers", []) or []),
            "signatures": list(getattr(note, "signatures", []) or []),
            "invitations": list(getattr(note, "invitations", []) or []),
            "content": getattr(note, "content", {}) or {},
            "tcdate": getattr(note, "tcdate", 0) or 0,
        }

    return {
        "id": raw.get("id", ""),
        "forum": raw.get("forum", ""),
        "replyto": raw.get("replyto"),
        "readers": list(raw.get("readers", []) or []),
        "signatures": list(raw.get("signatures", []) or []),
        "invitations": list(raw.get("invitations", []) or []),
        "content": raw.get("content", {}) or {},
        "tcdate": raw.get("tcdate", 0) or 0,
    }


def _group_members(group: Any) -> List[str]:
    return list(getattr(group, "members", []) or [])


def _anon_group_prefix(group_id: str) -> str:
    return f"{group_id[:-1] if group_id.endswith('s') else group_id}_"


def _resolve_bulk_group_members(group: Any, groups_by_id: Dict[str, Any]) -> tuple[List[str], bool]:
    members = _group_members(group)
    if not getattr(group, "anonids", None):
        return members, True

    anon_prefix = _anon_group_prefix(str(group.id))
    members_by_anonid = {
        group_id: group_members[0]
        for group_id, candidate_group in groups_by_id.items()
        if group_id.startswith(anon_prefix)
        for group_members in [_group_members(candidate_group)]
        if group_members
    }

    resolved_members: List[str] = []
    missing_anon_member = False
    for member in members:
        resolved_member = members_by_anonid.get(member)
        if resolved_member is None:
            missing_anon_member = missing_anon_member or member.startswith(anon_prefix)
            resolved_members.append(member)
        else:
            resolved_members.append(resolved_member)

    return resolved_members, not missing_anon_member


def _is_withdrawn(content: Dict[str, Any]) -> bool:
    withdrawal = _content_text(content.get("withdrawal_confirmation"))
    if withdrawal.strip():
        return True
    return "withdrawn" in _content_text(content.get("venue")).lower()


def _is_desk_rejected(content: Dict[str, Any]) -> bool:
    return "desk rejected" in _content_text(content.get("venue")).lower()


def _is_arr_stage(venue_id: str) -> bool:
    return venue_id.startswith(ARR_STAGE_PREFIX)


def _extract_paper_link(note: Any) -> str:
    content = getattr(note, "content", {}) or {}
    link = _first_content_value(content, ("paper_link", "Paper Link", "paperlink", "forum_link"))
    if link:
        return link.strip()
    raise ValueError(f"Commitment note {getattr(note, 'id', '')} does not contain a Paper Link field.")


def _extract_forum_id_from_link(link: str) -> str:
    parsed = urlparse(link)
    query = parse_qs(parsed.query)
    if query.get("id"):
        return query["id"][0]

    match = re.search(r"(?:forum|note)\?id=([^&#]+)", link)
    if match:
        return match.group(1)

    raise ValueError(f"Could not parse forum id from Paper Link: {link}")


def _safe_note_number(note: Any, fallback: int = 0) -> int:
    raw_number = getattr(note, "number", fallback) or fallback
    try:
        return int(raw_number)
    except (TypeError, ValueError):
        return fallback


def _has_venue_level_assignment(groups: set[str], venue_id: str) -> bool:
    return bool(groups & {f"{venue_id}/Area_Chairs", f"{venue_id}/Senior_Area_Chairs"})


class OpenReviewGateway:
    def authenticate(self, username: str, password: str) -> tuple[Any, ViewerInfo]:
        try:
            client = openreview.api.OpenReviewClient(
                baseurl=OPENREVIEW_BASE_URL,
                username=username,
                password=password,
            )
        except Exception as exc:
            raise AuthenticationError("Invalid OpenReview credentials.") from exc

        profile = client.user.get("profile", {})
        viewer = ViewerInfo(
            id=profile.get("id", ""),
            fullname=profile.get("fullname", profile.get("preferredName", "")),
        )
        return client, viewer

    def fetch_dashboard_snapshot(
        self,
        client: Any,
        venue_id: str,
        progress_callback: ProgressCallback | None = None,
    ) -> Dict[str, Any]:
        load_started_at = time.perf_counter()
        try:
            if progress_callback:
                progress_callback("venue", "Reading venue metadata...", 0, 0)
            phase_started_at = time.perf_counter()
            venue_group = client.get_group(venue_id)
            submission_name = _content_value(venue_group.content.get("submission_name"), "Submission")
            logger.warning(
                "Dashboard load phase venue_metadata completed in %.2fs for %s",
                time.perf_counter() - phase_started_at,
                venue_id,
            )
        except Exception as exc:
            raise DashboardFetchError(f"Could not load venue '{venue_id}'.") from exc

        profile = client.user.get("profile", {})
        viewer_id = profile.get("id", "")
        logger.warning("Loading dashboard snapshot for %s as %s", venue_id, viewer_id)

        if not _is_arr_stage(venue_id):
            return self._fetch_commitment_dashboard_snapshot(
                client=client,
                venue_id=venue_id,
                submission_name=submission_name,
                profile=profile,
                viewer_id=viewer_id,
                load_started_at=load_started_at,
                progress_callback=progress_callback,
            )

        try:
            if progress_callback:
                progress_callback("submissions", "Fetching venue submissions and replies...", 0, 0)
            phase_started_at = time.perf_counter()
            submissions = client.get_all_notes(
                invitation=f"{venue_id}/-/{submission_name}",
                details="replies",
            )
            replies_count = sum(
                len(((getattr(submission, "details", {}) or {}).get("replies", []) or []))
                for submission in submissions
            )
            logger.warning(
                "Dashboard load phase submissions_with_replies completed in %.2fs for %s: submissions=%s replies=%s",
                time.perf_counter() - phase_started_at,
                viewer_id,
                len(submissions),
                replies_count,
            )
        except Exception as exc:
            raise DashboardFetchError(f"Could not load submissions for venue '{venue_id}'.") from exc

        logger.warning("Fetched %s raw submissions for %s", len(submissions), viewer_id)

        try:
            if progress_callback:
                progress_callback("scope", "Resolving your SAC assignments...", 0, len(submissions))
            phase_started_at = time.perf_counter()
            matching_groups = client.get_all_groups(members=viewer_id, prefix=f"{venue_id}/{submission_name}")
            my_sac_groups = {
                group.id
                for group in matching_groups
                if group.id.endswith("Senior_Area_Chairs")
            }
            logger.warning(
                "Dashboard load phase sac_groups completed in %.2fs for %s: matching_groups=%s sac_groups=%s",
                time.perf_counter() - phase_started_at,
                viewer_id,
                len(matching_groups),
                len(my_sac_groups),
            )
        except Exception as exc:
            raise DashboardFetchError(f"Could not load SAC assignments for venue '{venue_id}'.") from exc

        logger.warning("Resolved %s SAC groups for %s", len(my_sac_groups), viewer_id)
        logger.warning("Scanning %s submissions for %s", len(submissions), viewer_id)

        candidate_submissions: List[Dict[str, Any]] = []
        withdrawn_candidate_submissions: List[Dict[str, Any]] = []
        collected_submissions: List[Dict[str, Any]] = []
        collected_withdrawn_submissions: List[Dict[str, Any]] = []
        total_submissions = len(submissions)
        scan_started_at = time.perf_counter()
        skipped_withdrawn = 0
        skipped_desk_rejected = 0
        skipped_out_of_scope = 0
        collected_replies = 0

        def make_submission_candidate(submission: Any, readers: List[str], content: Dict[str, Any]) -> Dict[str, Any]:
            prefix = f"{venue_id}/{submission_name}{submission.number}"
            replies = ((getattr(submission, "details", {}) or {}).get("replies", []) or [])
            return {
                "number": int(submission.number),
                "id": submission.id,
                "prefix": prefix,
                "readers": readers,
                "content": content,
                "replies": [_note_to_dict(reply) for reply in replies],
                "reply_count": len(replies),
            }

        for index, submission in enumerate(submissions, start=1):
            submission_number = int(getattr(submission, "number", 0) or 0)
            if progress_callback:
                progress_callback(
                    "papers",
                    f"Checking submission {submission_number} against your SAC batch...",
                    index,
                    total_submissions,
                )

            content = getattr(submission, "content", {}) or {}
            readers = list(getattr(submission, "readers", []) or [])
            if not (set(readers) & my_sac_groups):
                skipped_out_of_scope += 1
                continue

            candidate = make_submission_candidate(submission, readers, content)
            if _is_withdrawn(content):
                skipped_withdrawn += 1
                collected_replies += int(candidate["reply_count"])
                withdrawn_candidate_submissions.append(candidate)
                continue
            if _is_desk_rejected(content):
                skipped_desk_rejected += 1
                continue

            logger.warning(
                "Collecting submission %s (%s/%s) for %s",
                submission_number,
                index,
                total_submissions,
                viewer_id,
            )

            collected_replies += int(candidate["reply_count"])
            candidate_submissions.append(candidate)

        scan_seconds = time.perf_counter() - scan_started_at
        logger.warning(
            (
                "Dashboard load phase scan_submissions completed in %.2fs for %s: "
                "kept=%s withdrawn=%s skipped_desk_rejected=%s skipped_out_of_scope=%s "
                "collected_replies=%s"
            ),
            scan_seconds,
            viewer_id,
            len(candidate_submissions),
            len(withdrawn_candidate_submissions),
            skipped_desk_rejected,
            skipped_out_of_scope,
            collected_replies,
        )

        bulk_groups_by_id: Dict[str, Any] = {}
        paper_groups_by_id: Dict[str, Any] = {}
        all_scoped_candidates = candidate_submissions + withdrawn_candidate_submissions
        expected_group_ids = {
            f"{submission['prefix']}/Area_Chairs"
            for submission in all_scoped_candidates
        } | {
            f"{submission['prefix']}/Reviewers"
            for submission in candidate_submissions
        }
        bulk_group_seconds = 0.0
        bulk_groups_fetched = 0
        bulk_groups_matched = 0

        candidate_count = len(candidate_submissions) + len(withdrawn_candidate_submissions)
        if candidate_count:
            if progress_callback:
                progress_callback(
                    "groups",
                    "Resolving paper assignment groups in bulk...",
                    0,
                    candidate_count,
                )

            bulk_group_started_at = time.perf_counter()
            try:
                paper_groups = client.get_all_groups(prefix=f"{venue_id}/{submission_name}")
                bulk_group_seconds = time.perf_counter() - bulk_group_started_at
                bulk_groups_fetched = len(paper_groups)
                bulk_groups_by_id = {group.id: group for group in paper_groups}
                paper_groups_by_id = {
                    group_id: group
                    for group_id, group in bulk_groups_by_id.items()
                    if group_id in expected_group_ids
                }
                bulk_groups_matched = len(paper_groups_by_id)
                logger.warning(
                    (
                        "Dashboard load phase bulk_paper_groups completed in %.2fs for %s: "
                        "fetched_groups=%s matched_expected_groups=%s expected_groups=%s"
                    ),
                    bulk_group_seconds,
                    viewer_id,
                    bulk_groups_fetched,
                    bulk_groups_matched,
                    len(expected_group_ids),
                )
            except Exception:
                bulk_group_seconds = time.perf_counter() - bulk_group_started_at
                logger.warning(
                    (
                        "Dashboard load phase bulk_paper_groups failed in %.2fs for %s; "
                        "falling back to per-paper group lookups"
                    ),
                    bulk_group_seconds,
                    viewer_id,
                    exc_info=True,
                )

        fallback_group_calls = 0
        fallback_group_lookup_seconds = 0.0

        def resolve_group_members(group_id: str) -> List[str]:
            nonlocal fallback_group_calls, fallback_group_lookup_seconds

            group = paper_groups_by_id.get(group_id)
            if group is not None:
                members, fully_resolved = _resolve_bulk_group_members(group, bulk_groups_by_id)
                if fully_resolved:
                    return members
                logger.debug("Bulk group %s had unresolved anonymous members; falling back", group_id)

            fallback_started_at = time.perf_counter()
            fallback_group_calls += 1
            try:
                return list(client.get_group(group_id).members)
            except Exception:
                return []
            finally:
                fallback_group_lookup_seconds += time.perf_counter() - fallback_started_at

        for index, submission in enumerate(candidate_submissions, start=1):
            if progress_callback:
                progress_callback(
                    "groups",
                    f"Applying paper assignment groups for submission {submission['number']}...",
                    index,
                    candidate_count,
                )

            prefix = str(submission["prefix"])
            area_chairs = resolve_group_members(f"{prefix}/Area_Chairs")
            reviewers = resolve_group_members(f"{prefix}/Reviewers")
            logger.debug(
                "Dashboard paper assignment groups resolved for paper %s: area_chairs=%s reviewers=%s",
                submission["number"],
                len(area_chairs),
                len(reviewers),
            )

            collected_submissions.append(
                {
                    "number": submission["number"],
                    "id": submission["id"],
                    "readers": submission["readers"],
                    "content": submission["content"],
                    "replies": submission["replies"],
                    "area_chairs": area_chairs,
                    "reviewers": reviewers,
                }
            )

        for offset, submission in enumerate(withdrawn_candidate_submissions, start=len(candidate_submissions) + 1):
            if progress_callback:
                progress_callback(
                    "groups",
                    f"Applying withdrawn paper assignment group for submission {submission['number']}...",
                    offset,
                    candidate_count,
                )

            prefix = str(submission["prefix"])
            area_chairs = resolve_group_members(f"{prefix}/Area_Chairs")
            collected_withdrawn_submissions.append(
                {
                    "number": submission["number"],
                    "id": submission["id"],
                    "readers": submission["readers"],
                    "content": submission["content"],
                    "replies": submission["replies"],
                    "area_chairs": area_chairs,
                }
            )

        if progress_callback:
            progress_callback(
                "papers",
                (
                    f"Collected {len(collected_submissions)} active papers and "
                    f"{len(collected_withdrawn_submissions)} withdrawn papers in your SAC batch."
                ),
                total_submissions,
                total_submissions,
            )

        logger.warning(
            (
                "Dashboard load phase scan_and_group_lookup completed in %.2fs for %s: "
                "kept=%s withdrawn=%s skipped_withdrawn=%s skipped_desk_rejected=%s skipped_out_of_scope=%s "
                "collected_replies=%s group_lookup_seconds=%.2fs bulk_groups_fetched=%s "
                "bulk_groups_matched=%s fallback_group_calls=%s fallback_group_lookup_seconds=%.2fs"
            ),
            scan_seconds + bulk_group_seconds + fallback_group_lookup_seconds,
            viewer_id,
            len(collected_submissions),
            len(collected_withdrawn_submissions),
            skipped_withdrawn,
            skipped_desk_rejected,
            skipped_out_of_scope,
            collected_replies,
            bulk_group_seconds + fallback_group_lookup_seconds,
            bulk_groups_fetched,
            bulk_groups_matched,
            fallback_group_calls,
            fallback_group_lookup_seconds,
        )
        logger.warning(
            "Dashboard snapshot fetch completed in %.2fs for %s: kept_submissions=%s withdrawn_submissions=%s",
            time.perf_counter() - load_started_at,
            viewer_id,
            len(collected_submissions),
            len(collected_withdrawn_submissions),
        )

        return {
            "viewer": {
                "id": viewer_id,
                "fullname": profile.get("fullname", profile.get("preferredName", "")),
            },
            "submission_name": submission_name,
            "my_sac_groups": sorted(my_sac_groups),
            "submissions": collected_submissions,
            "withdrawn_submissions": collected_withdrawn_submissions,
        }

    def _fetch_commitment_dashboard_snapshot(
        self,
        client: Any,
        venue_id: str,
        submission_name: str,
        profile: Dict[str, Any],
        viewer_id: str,
        load_started_at: float,
        progress_callback: ProgressCallback | None = None,
    ) -> Dict[str, Any]:
        paper_entry_invitation = f"{venue_id}/-/{submission_name}"

        try:
            if progress_callback:
                progress_callback("submissions", "Fetching commitment paper entries...", 0, 0)
            phase_started_at = time.perf_counter()
            commitment_notes = client.get_all_notes(invitation=paper_entry_invitation)
            logger.warning(
                "Dashboard load phase commitment_entries completed in %.2fs for %s: entries=%s",
                time.perf_counter() - phase_started_at,
                viewer_id,
                len(commitment_notes),
            )
        except Exception as exc:
            raise DashboardFetchError(f"Could not load commitment paper entries for venue '{venue_id}'.") from exc

        try:
            if progress_callback:
                progress_callback("scope", "Resolving your commitment assignments...", 0, len(commitment_notes))
            phase_started_at = time.perf_counter()
            matching_groups = client.get_all_groups(members=viewer_id, prefix=venue_id)
            my_assignment_groups = {
                group.id
                for group in matching_groups
                if group.id.endswith("Area_Chairs") or group.id.endswith("Senior_Area_Chairs")
            }
            my_author_groups = {
                group.id
                for group in matching_groups
                if group.id.endswith("/Authors")
            }
            has_venue_level_assignment = _has_venue_level_assignment(my_assignment_groups, venue_id)
            logger.warning(
                (
                    "Dashboard load phase commitment_assignment_groups completed in %.2fs for %s: "
                    "assignment_groups=%s author_groups=%s venue_level_assignment=%s"
                ),
                time.perf_counter() - phase_started_at,
                viewer_id,
                len(my_assignment_groups),
                len(my_author_groups),
                has_venue_level_assignment,
            )
        except Exception as exc:
            raise DashboardFetchError(f"Could not load commitment assignments for venue '{venue_id}'.") from exc

        collected_submissions: List[Dict[str, Any]] = []
        total_entries = len(commitment_notes)
        skipped_missing_link = 0
        skipped_forum_load = 0
        skipped_ineligible = 0
        skipped_out_of_scope = 0
        skipped_out_of_scope_before_forum_load = 0
        skipped_author_entries = 0
        commitment_candidates: List[Dict[str, Any]] = []

        for index, batch_note in enumerate(commitment_notes, start=1):
            note_number = _safe_note_number(batch_note, index)
            if progress_callback:
                progress_callback(
                    "papers",
                    f"Checking commitment entry {note_number} against your assignment batch...",
                    index,
                    total_entries,
                )

            batch_readers = list(getattr(batch_note, "readers", None) or [])
            batch_reader_set = set(batch_readers)
            batch_assignment_match = bool(my_assignment_groups and (batch_reader_set & my_assignment_groups))
            batch_author_match = bool(my_author_groups and (batch_reader_set & my_author_groups))
            if batch_author_match and not batch_assignment_match:
                skipped_author_entries += 1
                skipped_out_of_scope += 1
                skipped_out_of_scope_before_forum_load += 1
                continue

            if my_assignment_groups and batch_readers and not batch_assignment_match and not has_venue_level_assignment:
                skipped_out_of_scope += 1
                skipped_out_of_scope_before_forum_load += 1
                continue

            try:
                paper_link = _extract_paper_link(batch_note)
                forum_id = _extract_forum_id_from_link(paper_link)
            except ValueError:
                skipped_missing_link += 1
                logger.warning("Skipping commitment entry %s with missing or invalid Paper Link", note_number)
                continue

            commitment_candidates.append(
                {
                    "batch_note": batch_note,
                    "batch_readers": batch_readers,
                    "forum_id": forum_id,
                    "commitment_url": OPENREVIEW_FORUM_URL.format(paper_id=getattr(batch_note, "id", "")),
                    "note_number": note_number,
                }
            )

        def load_commitment_candidate(candidate: Dict[str, Any]) -> Dict[str, Any]:
            batch_note = candidate["batch_note"]
            batch_readers = candidate["batch_readers"]
            forum_id = str(candidate["forum_id"])
            commitment_url = str(candidate["commitment_url"])
            note_number = int(candidate["note_number"])

            try:
                forum_note = client.get_note(forum_id, details="replies")
            except Exception:
                logger.warning(
                    "Skipping commitment entry %s because linked forum %s could not be loaded",
                    note_number,
                    forum_id,
                )
                return {"status": "forum_load_error"}

            forum_content = dict(getattr(forum_note, "content", {}) or {})
            for key, value in (getattr(batch_note, "content", {}) or {}).items():
                forum_content.setdefault(key, value)
            if _is_withdrawn(forum_content) or _is_desk_rejected(forum_content):
                return {"status": "ineligible"}

            readers = batch_readers or list(getattr(forum_note, "readers", None) or [])
            reader_set = set(readers)
            reader_assignment_match = bool(my_assignment_groups and (reader_set & my_assignment_groups))
            reader_author_match = bool(my_author_groups and (reader_set & my_author_groups))
            if reader_author_match and not reader_assignment_match:
                return {"status": "author"}

            if my_assignment_groups and not reader_assignment_match and not has_venue_level_assignment:
                return {"status": "out_of_scope"}

            effective_readers = set(readers)
            if has_venue_level_assignment:
                effective_readers.update(my_assignment_groups)
            if not my_assignment_groups:
                effective_readers.add(viewer_id)

            replies = ((getattr(forum_note, "details", {}) or {}).get("replies", []) or [])
            area_chair = self._commitment_area_chair(
                client=client,
                batch_note=batch_note,
                forum_note=forum_note,
                venue_id=venue_id,
                submission_name=submission_name,
            )
            reviewers = self._commitment_reviewers(
                client=client,
                forum_note=forum_note,
                venue_id=venue_id,
                submission_name=submission_name,
            )

            return {
                "status": "kept",
                "submission": {
                    "number": note_number,
                    "id": getattr(forum_note, "id", forum_id),
                    "forum_url": commitment_url,
                    "readers": sorted(effective_readers),
                    "content": forum_content,
                    "replies": [_note_to_dict(reply) for reply in replies],
                    "area_chairs": [area_chair],
                    "reviewers": reviewers,
                },
            }

        if commitment_candidates and progress_callback:
            progress_callback(
                "papers",
                "Loading linked commitment paper forums...",
                0,
                len(commitment_candidates),
            )

        if commitment_candidates:
            load_started = time.perf_counter()
            max_workers = min(MAX_COMMITMENT_LOAD_WORKERS, len(commitment_candidates))
            with ThreadPoolExecutor(max_workers=max_workers) as executor:
                future_to_candidate = {
                    executor.submit(load_commitment_candidate, candidate): candidate
                    for candidate in commitment_candidates
                }
                for completed, future in enumerate(as_completed(future_to_candidate), start=1):
                    if progress_callback:
                        progress_callback(
                            "papers",
                            f"Loaded {completed} of {len(commitment_candidates)} linked paper forums...",
                            completed,
                            len(commitment_candidates),
                        )

                    result = future.result()
                    status = result.get("status")
                    if status == "kept":
                        collected_submissions.append(result["submission"])
                    elif status == "forum_load_error":
                        skipped_forum_load += 1
                    elif status == "ineligible":
                        skipped_ineligible += 1
                    elif status == "author":
                        skipped_author_entries += 1
                        skipped_out_of_scope += 1
                    elif status == "out_of_scope":
                        skipped_out_of_scope += 1

            logger.warning(
                "Dashboard load phase commitment_linked_forums completed in %.2fs for %s: candidates=%s kept=%s workers=%s",
                time.perf_counter() - load_started,
                viewer_id,
                len(commitment_candidates),
                len(collected_submissions),
                max_workers,
            )

        if progress_callback:
            progress_callback(
                "papers",
                f"Collected {len(collected_submissions)} committed papers in your assignment batch.",
                total_entries,
                total_entries,
            )

        logger.warning(
            (
                "Dashboard commitment snapshot fetch completed in %.2fs for %s: kept=%s "
                "skipped_missing_link=%s skipped_forum_load=%s skipped_ineligible=%s skipped_out_of_scope=%s "
                "skipped_out_of_scope_before_forum_load=%s skipped_author_entries=%s"
            ),
            time.perf_counter() - load_started_at,
            viewer_id,
            len(collected_submissions),
            skipped_missing_link,
            skipped_forum_load,
            skipped_ineligible,
            skipped_out_of_scope,
            skipped_out_of_scope_before_forum_load,
            skipped_author_entries,
        )

        return {
            "viewer": {
                "id": viewer_id,
                "fullname": profile.get("fullname", profile.get("preferredName", "")),
            },
            "submission_name": submission_name,
            "my_sac_groups": sorted(my_assignment_groups) if my_assignment_groups else [viewer_id],
            "submissions": collected_submissions,
            "withdrawn_submissions": [],
        }

    def _commitment_area_chair(
        self,
        client: Any,
        batch_note: Any,
        forum_note: Any,
        venue_id: str,
        submission_name: str,
    ) -> str:
        batch_content = getattr(batch_note, "content", {}) or {}
        content_area_chair = _first_content_value(batch_content, ("area_chair", "Area Chair", "area chair"))
        if content_area_chair:
            return content_area_chair

        paper_number = _safe_note_number(forum_note)
        if not paper_number:
            return ""

        for group_id in (
            f"{venue_id}/{submission_name}{paper_number}/Area_Chairs",
            f"{venue_id}/Submission{paper_number}/Area_Chairs",
            f"{venue_id}/Paper{paper_number}/Area_Chairs",
        ):
            try:
                members = list(client.get_group(group_id).members)
            except Exception:
                continue
            if members:
                return members[0]

        return ""

    def _commitment_reviewers(
        self,
        client: Any,
        forum_note: Any,
        venue_id: str,
        submission_name: str,
    ) -> List[str]:
        paper_number = _safe_note_number(forum_note)
        if not paper_number:
            return []

        for group_id in (
            f"{venue_id}/{submission_name}{paper_number}/Reviewers",
            f"{venue_id}/Submission{paper_number}/Reviewers",
            f"{venue_id}/Paper{paper_number}/Reviewers",
        ):
            try:
                return list(client.get_group(group_id).members)
            except Exception:
                continue

        return []
