from __future__ import annotations

import logging
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Callable, Dict, Iterable, List
from urllib.parse import parse_qs, urlparse

import openreview
import requests

from app.schemas import ViewerInfo
from app.session_store import DEFAULT_SESSION_TTL_SECONDS

OPENREVIEW_BASE_URL = "https://api2.openreview.net"
OPENREVIEW_FORUM_URL = "https://openreview.net/forum?id={paper_id}"
ARR_STAGE_PREFIX = "aclweb.org/ACL/ARR"
MAX_COMMITMENT_LOAD_WORKERS = 8
MAX_ARR_DETAIL_LOAD_WORKERS = 8
MAX_AREA_CHAIR_CONTACT_WORKERS = 8
OPENREVIEW_CONNECT_TIMEOUT_SECONDS = 10
OPENREVIEW_READ_TIMEOUT_SECONDS = 180
logger = logging.getLogger(__name__)
ProgressCallback = Callable[[str, str, int, int], None]


class AuthenticationError(Exception):
    pass


class AuthenticationMfaRequired(Exception):
    pass


class AuthenticationServiceError(Exception):
    pass


class DashboardFetchError(Exception):
    pass


class DashboardAuthenticationError(DashboardFetchError):
    pass


def _exception_status(exc: BaseException) -> int | None:
    response = getattr(exc, "response", None)
    response_status = getattr(response, "status_code", None)
    if isinstance(response_status, int):
        return response_status

    pending: List[Any] = list(getattr(exc, "args", ()))
    while pending:
        value = pending.pop(0)
        if isinstance(value, dict):
            for key in ("status", "statusCode", "status_code"):
                status = value.get(key)
                if isinstance(status, int):
                    return status
                if isinstance(status, str) and status.isdigit():
                    return int(status)
            pending.extend(value.values())
        elif isinstance(value, (list, tuple)):
            pending.extend(value)

    return None


def _raise_if_authentication_error(exc: BaseException) -> None:
    if isinstance(exc, DashboardAuthenticationError):
        raise exc
    if _exception_status(exc) == 401:
        raise DashboardAuthenticationError("OpenReview session expired. Log in again.") from exc


def _is_missing_group_error(exc: BaseException) -> bool:
    if isinstance(exc, IndexError):
        return True

    status = _exception_status(exc)
    if status is not None:
        return status == 404

    message = str(exc).lower()
    return "group not found" in message or "group was not found" in message


def _configure_client_timeouts(client: Any) -> None:
    session = getattr(client, "session", None)
    if session is None or getattr(session, "_arr_sac_timeout_configured", False):
        return

    original_request = session.request

    def request_with_timeout(method: str, url: str, **kwargs):
        kwargs.setdefault(
            "timeout",
            (OPENREVIEW_CONNECT_TIMEOUT_SECONDS, OPENREVIEW_READ_TIMEOUT_SECONDS),
        )
        response = original_request(method, url, **kwargs)
        is_authenticated_api_request = bool(getattr(client, "token", None)) and url != getattr(
            client,
            "login_url",
            None,
        )
        if is_authenticated_api_request and getattr(response, "status_code", None) == 401:
            raise DashboardAuthenticationError("OpenReview session expired. Log in again.")
        return response

    session.request = request_with_timeout
    session._arr_sac_timeout_configured = True


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


def _resolve_group_members(
    client: Any,
    group_ids: Iterable[str],
    groups_by_id: Dict[str, Any] | None = None,
    *,
    continue_on_empty: bool = False,
) -> List[str]:
    groups_by_id = groups_by_id or {}
    for group_id in group_ids:
        group = groups_by_id.get(group_id)
        if group is not None:
            members, fully_resolved = _resolve_bulk_group_members(group, groups_by_id)
            if fully_resolved:
                if members or not continue_on_empty:
                    return members
                continue
            logger.debug("Bulk group %s had unresolved anonymous members; falling back", group_id)

        try:
            members = list(client.get_group(group_id).members)
        except requests.RequestException as exc:
            _raise_if_authentication_error(exc)
            raise DashboardFetchError(f"Could not resolve assignment group '{group_id}'.") from exc
        except Exception as exc:
            _raise_if_authentication_error(exc)
            if _is_missing_group_error(exc):
                continue
            raise DashboardFetchError(f"Could not resolve assignment group '{group_id}'.") from exc
        if members or not continue_on_empty:
            return members

    return []


def _profile_content(profile: Any) -> Dict[str, Any]:
    content = getattr(profile, "content", None)
    return content if isinstance(content, dict) else {}


def _profile_email(profile: Any) -> str:
    content = _profile_content(profile)
    preferred_email = content.get("preferredEmail")
    if _is_usable_email(preferred_email):
        return str(preferred_email)

    emails_confirmed = content.get("emailsConfirmed")
    email = _first_usable_email(emails_confirmed)
    if email:
        return email

    emails = content.get("emails")
    email = _first_usable_email(emails)
    if email:
        return email

    try:
        preferred = profile.get_preferred_email()
    except Exception:
        return ""

    return str(preferred) if _is_usable_email(preferred) else ""


def _is_usable_email(value: Any) -> bool:
    if not isinstance(value, str):
        return False

    stripped = value.strip()
    if "@" not in stripped or "*" in stripped:
        return False

    local_part, domain = stripped.split("@", 1)
    return bool(local_part and domain and "." in domain)


def _first_usable_email(values: Any) -> str:
    if not isinstance(values, list):
        return ""

    for value in values:
        if _is_usable_email(value):
            return str(value)

    return ""


def _profile_group_email(client: Any, profile_id: str) -> str:
    try:
        group = client.get_group(profile_id)
    except Exception as exc:
        _raise_if_authentication_error(exc)
        return ""

    return _first_usable_email(_group_members(group))


def _profile_display_name(profile: Any, fallback: str) -> str:
    content = _profile_content(profile)
    names = content.get("names")
    if isinstance(names, list) and names:
        preferred_name = next(
            (name for name in names if isinstance(name, dict) and name.get("preferred")),
            None,
        )
        name = preferred_name or next((name for name in names if isinstance(name, dict)), None)
        if name:
            fullname = _content_text(name.get("fullname")).strip()
            if fullname:
                return fullname
            parts = [
                _content_text(name.get("first")).strip(),
                _content_text(name.get("middle")).strip(),
                _content_text(name.get("last")).strip(),
            ]
            joined = " ".join(part for part in parts if part)
            if joined:
                return joined

    fullname = _content_text(content.get("preferredName")).strip()
    if fullname:
        return fullname

    profile_fullname = _content_text(getattr(profile, "fullname", "")).strip()
    if profile_fullname:
        return profile_fullname

    return _profile_id_to_display_name(fallback)


def _profile_id_to_display_name(profile_id: str) -> str:
    normalized = profile_id.strip().lstrip("~")
    normalized = re.sub(r"\d+$", "", normalized)
    normalized = normalized.replace("_", " ").strip()
    return normalized or profile_id


def _preferred_email_edges(client: Any, invitation_id: str) -> Dict[str, str]:
    if not invitation_id:
        return {}

    try:
        grouped_edges = client.get_grouped_edges(
            invitation=invitation_id,
            groupby="head",
            select="tail",
        )
    except Exception as exc:
        _raise_if_authentication_error(exc)
        logger.warning("Could not load preferred-email edges from %s", invitation_id, exc_info=True)
        return {}

    preferred_email_by_profile_id: Dict[str, str] = {}
    for grouped_edge in grouped_edges:
        head = str((grouped_edge.get("id") or {}).get("head") or "")
        if not head:
            continue
        for value in grouped_edge.get("values", []) or []:
            tail = value.get("tail") if isinstance(value, dict) else None
            if _is_usable_email(tail):
                preferred_email_by_profile_id[head] = str(tail)
                break

    return preferred_email_by_profile_id


def _lookup_area_chair_contact(
    client: Any,
    profile_id: str,
    preferred_email_by_profile_id: Dict[str, str],
) -> Dict[str, str]:
    try:
        profile = client.get_profile(profile_id)
    except Exception as exc:
        _raise_if_authentication_error(exc)
        try:
            profiles = client.search_profiles(ids=[profile_id])
            profile = profiles[0] if profiles else None
        except Exception as fallback_exc:
            _raise_if_authentication_error(fallback_exc)
            profile = None

    if profile is None:
        logger.warning("Could not resolve OpenReview profile for area chair %s", profile_id)
        return {
            "name": _profile_id_to_display_name(profile_id),
            "email": "",
        }

    edge_email = preferred_email_by_profile_id.get(profile_id, "")
    email = (
        edge_email
        if _is_usable_email(edge_email)
        else _profile_email(profile) or _profile_group_email(client, profile_id)
    )

    return {
        "name": _profile_display_name(profile, profile_id),
        "email": email,
    }


def _area_chair_contacts(
    client: Any,
    submissions: List[Dict[str, Any]],
    preferred_emails_invitation_id: str,
) -> Dict[str, Dict[str, str]]:
    area_chair_ids = sorted(
        {
            str(area_chair)
            for submission in submissions
            for area_chair in submission.get("area_chairs", []) or []
            if str(area_chair).strip()
        }
    )
    if not area_chair_ids:
        return {}

    started_at = time.perf_counter()
    preferred_email_by_profile_id = _preferred_email_edges(client, preferred_emails_invitation_id)
    contacts: Dict[str, Dict[str, str]] = {}
    max_workers = min(MAX_AREA_CHAIR_CONTACT_WORKERS, len(area_chair_ids))
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_area_chair_id = {
            executor.submit(
                _lookup_area_chair_contact,
                client,
                area_chair_id,
                preferred_email_by_profile_id,
            ): area_chair_id
            for area_chair_id in area_chair_ids
        }
        for future in as_completed(future_to_area_chair_id):
            area_chair_id = future_to_area_chair_id[future]
            contacts[area_chair_id] = future.result()

    contacts = {area_chair_id: contacts[area_chair_id] for area_chair_id in area_chair_ids}
    logger.warning(
        "Dashboard load phase area_chair_contacts completed in %.2fs: profiles=%s emails=%s workers=%s",
        time.perf_counter() - started_at,
        len(contacts),
        sum(1 for contact in contacts.values() if contact.get("email")),
        max_workers,
    )
    return contacts


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
        normalized_username = username.strip()
        if not normalized_username or not password:
            raise AuthenticationError("Enter both your OpenReview email and password.")

        try:
            client = openreview.api.OpenReviewClient(baseurl=OPENREVIEW_BASE_URL)
            _configure_client_timeouts(client)
            response = client.session.post(
                client.login_url,
                headers=client.headers,
                json={
                    "id": normalized_username,
                    "password": password,
                    "expiresIn": DEFAULT_SESSION_TTL_SECONDS,
                },
            )
        except requests.RequestException as exc:
            raise AuthenticationServiceError("Could not reach OpenReview. Try again in a moment.") from exc
        except Exception as exc:
            raise AuthenticationServiceError("OpenReview login could not be started.") from exc

        if response.status_code in {400, 401, 403}:
            raise AuthenticationError("Invalid OpenReview credentials.")
        if not response.ok:
            raise AuthenticationServiceError(
                f"OpenReview login is unavailable (HTTP {response.status_code}). Try again in a moment."
            )

        try:
            login_payload = response.json()
        except ValueError as exc:
            raise AuthenticationServiceError("OpenReview returned an invalid login response.") from exc

        if login_payload.get("mfaPending"):
            methods = login_payload.get("mfaMethods") or []
            method_label = ", ".join(str(method) for method in methods) or "an additional verification method"
            raise AuthenticationMfaRequired(
                f"OpenReview requires MFA ({method_label}). Browser-based MFA is not supported by this dashboard."
            )

        token = login_payload.get("token")
        user = login_payload.get("user")
        if not token or not isinstance(user, dict):
            raise AuthenticationServiceError("OpenReview returned an incomplete login response.")

        client.token = str(token)
        client.user = user
        client.headers["Authorization"] = f"Bearer {client.token}"

        profile = user.get("profile", {})
        if not isinstance(profile, dict):
            raise AuthenticationServiceError("OpenReview returned an invalid viewer profile.")
        if not profile.get("id"):
            raise AuthenticationServiceError("OpenReview did not return a viewer profile ID.")

        try:
            viewer = ViewerInfo(
                id=profile.get("id", ""),
                fullname=profile.get("fullname", profile.get("preferredName", "")),
            )
        except Exception as exc:
            raise AuthenticationServiceError("OpenReview returned an invalid viewer profile.") from exc

        return client, viewer

    def fetch_dashboard_snapshot(
        self,
        client: Any,
        venue_id: str,
        progress_callback: ProgressCallback | None = None,
    ) -> Dict[str, Any]:
        _configure_client_timeouts(client)
        load_started_at = time.perf_counter()
        try:
            if progress_callback:
                progress_callback("venue", "Reading venue metadata...", 0, 0)
            phase_started_at = time.perf_counter()
            venue_group = client.get_group(venue_id)
            submission_name = _content_value(venue_group.content.get("submission_name"), "Submission")
            preferred_emails_invitation_id = (
                _content_value(venue_group.content.get("preferred_emails_id"), "").strip()
                or f"{venue_id}/-/Preferred_Emails"
            )
            logger.warning(
                "Dashboard load phase venue_metadata completed in %.2fs for %s",
                time.perf_counter() - phase_started_at,
                venue_id,
            )
        except Exception as exc:
            _raise_if_authentication_error(exc)
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
                progress_callback("scope", "Resolving your SAC assignments...", 0, 0)
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
            _raise_if_authentication_error(exc)
            raise DashboardFetchError(f"Could not load SAC assignments for venue '{venue_id}'.") from exc

        logger.warning("Resolved %s SAC groups for %s", len(my_sac_groups), viewer_id)

        paper_group_pattern = re.compile(
            rf"^{re.escape(venue_id)}/{re.escape(submission_name)}(\d+)/Senior_Area_Chairs$"
        )
        assigned_numbers = sorted(
            {
                int(match.group(1))
                for group_id in my_sac_groups
                if (match := paper_group_pattern.match(group_id)) is not None
            }
        )
        submissions: List[Any] = []
        if assigned_numbers:
            if progress_callback:
                progress_callback(
                    "submissions",
                    "Fetching metadata for your assigned submissions...",
                    0,
                    len(assigned_numbers),
                )
            phase_started_at = time.perf_counter()
            max_workers = min(MAX_ARR_DETAIL_LOAD_WORKERS, len(assigned_numbers))
            try:
                with ThreadPoolExecutor(max_workers=max_workers) as executor:
                    futures = {
                        executor.submit(
                            client.get_all_notes,
                            invitation=f"{venue_id}/-/{submission_name}",
                            number=number,
                        ): number
                        for number in assigned_numbers
                    }
                    for completed, future in enumerate(as_completed(futures), start=1):
                        submissions.extend(list(future.result()))
                        if progress_callback:
                            progress_callback(
                                "submissions",
                                f"Loaded metadata for {completed} of {len(assigned_numbers)} assigned submissions...",
                                completed,
                                len(assigned_numbers),
                            )
            except Exception as exc:
                _raise_if_authentication_error(exc)
                raise DashboardFetchError(f"Could not load assigned submissions for venue '{venue_id}'.") from exc
            logger.warning(
                "Dashboard load phase assigned_submission_metadata completed in %.2fs for %s: assignments=%s submissions=%s",
                time.perf_counter() - phase_started_at,
                viewer_id,
                len(assigned_numbers),
                len(submissions),
            )

        submissions.sort(key=lambda submission: int(getattr(submission, "number", 0) or 0))
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
            sac_group = f"{prefix}/Senior_Area_Chairs"
            return {
                "number": int(submission.number),
                "id": submission.id,
                "prefix": prefix,
                "sac_group": sac_group,
                "readers": readers,
                "content": content,
                "source_note": submission,
                "replies": [],
                "reply_count": 0,
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
            candidate = make_submission_candidate(submission, readers, content)
            if candidate["sac_group"] not in my_sac_groups and not (set(readers) & my_sac_groups):
                skipped_out_of_scope += 1
                continue

            if _is_withdrawn(content):
                skipped_withdrawn += 1
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

            candidate_submissions.append(candidate)

        all_scoped_candidates = candidate_submissions + withdrawn_candidate_submissions

        def load_candidate_replies(candidate: Dict[str, Any]) -> tuple[Dict[str, Any], List[Any]]:
            source_details = getattr(candidate["source_note"], "details", {}) or {}
            if "replies" in source_details:
                return candidate, list(source_details.get("replies") or [])
            detailed_note = client.get_note(str(candidate["id"]), details="replies")
            replies = ((getattr(detailed_note, "details", {}) or {}).get("replies", []) or [])
            return candidate, list(replies)

        if all_scoped_candidates:
            if progress_callback:
                progress_callback(
                    "replies",
                    "Fetching replies for submissions in your SAC batch...",
                    0,
                    len(all_scoped_candidates),
                )
            max_workers = min(MAX_ARR_DETAIL_LOAD_WORKERS, len(all_scoped_candidates))
            try:
                with ThreadPoolExecutor(max_workers=max_workers) as executor:
                    futures = [executor.submit(load_candidate_replies, candidate) for candidate in all_scoped_candidates]
                    for completed, future in enumerate(as_completed(futures), start=1):
                        candidate, replies = future.result()
                        candidate["replies"] = [_note_to_dict(reply) for reply in replies]
                        candidate["reply_count"] = len(replies)
                        collected_replies += len(replies)
                        if progress_callback:
                            progress_callback(
                                "replies",
                                f"Loaded replies for {completed} of {len(all_scoped_candidates)} submissions...",
                                completed,
                                len(all_scoped_candidates),
                            )
            except Exception as exc:
                _raise_if_authentication_error(exc)
                raise DashboardFetchError(
                    f"Could not load replies for assigned submissions in venue '{venue_id}'."
                ) from exc

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
            except Exception as exc:
                _raise_if_authentication_error(exc)
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
            except Exception as exc:
                _raise_if_authentication_error(exc)
                raise DashboardFetchError(f"Could not resolve assignment group '{group_id}'.") from exc
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
                    "prefix": submission["prefix"],
                    "sac_group": submission["sac_group"],
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
                    "prefix": submission["prefix"],
                    "sac_group": submission["sac_group"],
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

        area_chair_contacts = _area_chair_contacts(
            client,
            collected_submissions,
            preferred_emails_invitation_id,
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
            "area_chair_contacts": area_chair_contacts,
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
            _raise_if_authentication_error(exc)
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
            _raise_if_authentication_error(exc)
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

        commitment_groups_by_id: Dict[str, Any] = {}
        if commitment_candidates:
            phase_started_at = time.perf_counter()
            try:
                commitment_groups = client.get_all_groups(prefix=venue_id)
                commitment_groups_by_id = {group.id: group for group in commitment_groups}
                logger.warning(
                    "Dashboard load phase commitment_groups completed in %.2fs for %s: groups=%s",
                    time.perf_counter() - phase_started_at,
                    viewer_id,
                    len(commitment_groups_by_id),
                )
            except Exception as exc:
                _raise_if_authentication_error(exc)
                logger.warning(
                    "Dashboard load phase commitment_groups failed in %.2fs for %s; falling back to per-paper group lookups",
                    time.perf_counter() - phase_started_at,
                    viewer_id,
                    exc_info=True,
                )

        def load_commitment_candidate(candidate: Dict[str, Any]) -> Dict[str, Any]:
            batch_note = candidate["batch_note"]
            batch_readers = candidate["batch_readers"]
            forum_id = str(candidate["forum_id"])
            commitment_url = str(candidate["commitment_url"])
            note_number = int(candidate["note_number"])

            try:
                forum_note = client.get_note(forum_id, details="replies")
            except Exception as exc:
                _raise_if_authentication_error(exc)
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
                groups_by_id=commitment_groups_by_id,
            )
            reviewers = self._commitment_reviewers(
                client=client,
                forum_note=forum_note,
                venue_id=venue_id,
                submission_name=submission_name,
                groups_by_id=commitment_groups_by_id,
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
                    "area_chairs": [area_chair or "Unassigned"],
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

                    try:
                        result = future.result()
                    except Exception as exc:
                        _raise_if_authentication_error(exc)
                        candidate = future_to_candidate[future]
                        raise DashboardFetchError(
                            f"Could not load commitment entry {candidate['note_number']}."
                        ) from exc
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

        if skipped_missing_link or skipped_forum_load:
            raise DashboardFetchError(
                "The commitment dashboard could not be loaded completely: "
                f"invalid paper links={skipped_missing_link}, unavailable linked forums={skipped_forum_load}."
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
        groups_by_id: Dict[str, Any] | None = None,
    ) -> str:
        batch_content = getattr(batch_note, "content", {}) or {}
        content_area_chair = _first_content_value(batch_content, ("area_chair", "Area Chair", "area chair"))
        if content_area_chair:
            return content_area_chair

        paper_number = _safe_note_number(forum_note)
        if not paper_number:
            return ""

        members = _resolve_group_members(
            client,
            (
                f"{venue_id}/{submission_name}{paper_number}/Area_Chairs",
                f"{venue_id}/Submission{paper_number}/Area_Chairs",
                f"{venue_id}/Paper{paper_number}/Area_Chairs",
            ),
            groups_by_id,
            continue_on_empty=True,
        )
        if members:
            return members[0]

        return ""

    def _commitment_reviewers(
        self,
        client: Any,
        forum_note: Any,
        venue_id: str,
        submission_name: str,
        groups_by_id: Dict[str, Any] | None = None,
    ) -> List[str]:
        paper_number = _safe_note_number(forum_note)
        if not paper_number:
            return []

        return _resolve_group_members(
            client,
            (
                f"{venue_id}/{submission_name}{paper_number}/Reviewers",
                f"{venue_id}/Submission{paper_number}/Reviewers",
                f"{venue_id}/Paper{paper_number}/Reviewers",
            ),
            groups_by_id,
        )
