from __future__ import annotations

import logging
import re
import time
from datetime import datetime, timezone
from typing import Any, Callable, Dict, Iterable, List
from urllib.parse import parse_qs, urlparse

import openreview
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from app.schemas import ViewerInfo
from app.session_store import DEFAULT_SESSION_TTL_SECONDS

OPENREVIEW_BASE_URL = "https://api2.openreview.net"
OPENREVIEW_FORUM_URL = "https://openreview.net/forum?id={paper_id}"
ARR_STAGE_PREFIX = "aclweb.org/ACL/ARR"
OPENREVIEW_NOTE_BATCH_SIZE = 50
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


class DashboardRateLimitError(DashboardFetchError):
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


def _exception_value(exc: BaseException, target_key: str) -> Any:
    pending: List[Any] = list(getattr(exc, "args", ()))
    response = getattr(exc, "response", None)
    response_json = getattr(response, "json", None)
    if callable(response_json):
        try:
            pending.append(response_json())
        except (requests.RequestException, ValueError):
            pass

    while pending:
        value = pending.pop(0)
        if isinstance(value, dict):
            if target_key in value:
                return value[target_key]
            pending.extend(value.values())
        elif isinstance(value, (list, tuple)):
            pending.extend(value)

    return None


def _rate_limit_message(exc: BaseException) -> str:
    reset_time = _exception_value(exc, "resetTime")
    if isinstance(reset_time, str):
        try:
            parsed_reset_time = datetime.fromisoformat(reset_time.replace("Z", "+00:00"))
            reset_time_utc = parsed_reset_time.astimezone(timezone.utc)
            return (
                "OpenReview rate limit reached. Try Load / Refresh again after "
                f"{reset_time_utc.strftime('%Y-%m-%d %H:%M:%S UTC')}."
            )
        except ValueError:
            pass

    return "OpenReview rate limit reached. Wait for its request window to reset, then try Load / Refresh again."


def _raise_if_authentication_error(exc: BaseException) -> None:
    if isinstance(exc, (DashboardAuthenticationError, DashboardRateLimitError)):
        raise exc
    status = _exception_status(exc)
    if status == 401:
        raise DashboardAuthenticationError("OpenReview session expired. Log in again.") from exc
    if status == 429:
        raise DashboardRateLimitError(_rate_limit_message(exc)) from exc


def _configure_client_timeouts(client: Any) -> None:
    session = getattr(client, "session", None)
    if session is None or getattr(session, "_arr_sac_timeout_configured", False):
        return

    mount = getattr(session, "mount", None)
    if callable(mount):
        # openreview-py enables Retry-After retries for HTTP 429 responses. A venue
        # request can otherwise remain asleep for almost an hour without returning
        # useful state to the dashboard. Keep short upstream/server retries, but let
        # the application surface rate limits immediately.
        retry_strategy = Retry(
            total=3,
            backoff_factor=1,
            status_forcelist=(500, 502, 503, 504),
            respect_retry_after_header=False,
        )
        adapter = HTTPAdapter(max_retries=retry_strategy)
        mount("https://", adapter)
        mount("http://", adapter)

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


def _content_bool(value: Any, default: bool = False) -> bool:
    if isinstance(value, dict):
        value = value.get("value", default)
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "1", "yes"}:
            return True
        if normalized in {"false", "0", "no", ""}:
            return False
    return default


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


def _load_notes_in_batches(
    client: Any,
    *,
    filter_name: str,
    values: Iterable[str | int],
    invitation: str | None = None,
    details: str | None = None,
) -> List[Any]:
    session = getattr(client, "session", None)
    notes_url = getattr(client, "notes_url", None)
    headers = getattr(client, "headers", None)
    if session is None or not isinstance(notes_url, str) or not isinstance(headers, dict):
        raise DashboardFetchError("The OpenReview client does not support bounded batch note loading.")

    unique_values: List[str | int] = []
    seen_values: set[str] = set()
    for value in values:
        normalized_value: str | int = value if isinstance(value, int) else str(value).strip()
        normalized_key = str(normalized_value)
        if not normalized_key or normalized_key in seen_values:
            continue
        seen_values.add(normalized_key)
        unique_values.append(normalized_value)
    notes: List[Any] = []
    for offset in range(0, len(unique_values), OPENREVIEW_NOTE_BATCH_SIZE):
        batch = unique_values[offset : offset + OPENREVIEW_NOTE_BATCH_SIZE]
        params: Dict[str, Any] = {
            filter_name: batch,
            "limit": len(batch),
        }
        if invitation:
            params["invitation"] = invitation
        if details:
            params["details"] = details
        response = session.get(
            notes_url,
            params=params,
            headers=headers,
        )
        response.raise_for_status()
        payload = response.json()
        raw_notes = payload.get("notes") if isinstance(payload, dict) else None
        if not isinstance(raw_notes, list):
            raise DashboardFetchError("OpenReview returned an invalid batch-note response.")

        for raw_note in raw_notes:
            if not isinstance(raw_note, dict):
                raise DashboardFetchError("OpenReview returned an invalid batch-note entry.")
            notes.append(openreview.api.Note.from_json(raw_note))

    return notes


def _load_notes_by_ids(
    client: Any,
    note_ids: Iterable[str],
    *,
    details: str | None = None,
) -> Dict[str, Any]:
    notes = _load_notes_in_batches(
        client,
        filter_name="ids",
        values=note_ids,
        details=details,
    )
    return {
        str(note.id): note
        for note in notes
        if getattr(note, "id", None)
    }


def _load_notes_by_numbers_with_replies(
    client: Any,
    invitation: str,
    note_numbers: Iterable[int],
) -> List[Any]:
    return _load_notes_in_batches(
        client,
        filter_name="number",
        values=note_numbers,
        invitation=invitation,
        details="replies",
    )


def _load_notes_by_ids_with_replies(client: Any, note_ids: Iterable[str]) -> Dict[str, Any]:
    return _load_notes_by_ids(client, note_ids, details="replies")


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
    group_ids: Iterable[str],
    groups_by_id: Dict[str, Any],
    *,
    continue_on_empty: bool = False,
) -> List[str]:
    for group_id in group_ids:
        group = groups_by_id.get(group_id)
        if group is None:
            continue

        members, fully_resolved = _resolve_bulk_group_members(group, groups_by_id)
        if not fully_resolved:
            raise DashboardFetchError(
                f"OpenReview's bulk response could not resolve anonymous members for assignment group '{group_id}'."
            )
        if members or not continue_on_empty:
            return members

    return []


def _assignment_members_by_head_from_edges(edges: Iterable[Any]) -> Dict[str, List[str]]:
    members_by_head: Dict[str, List[str]] = {}
    for edge in edges:
        head = str(getattr(edge, "head", "") or "").strip()
        tail = str(getattr(edge, "tail", "") or "").strip()
        if not head or not tail:
            continue
        members = members_by_head.setdefault(head, [])
        if tail not in members:
            members.append(tail)
    return members_by_head


def _assignment_members_by_head(client: Any, invitation_id: str) -> Dict[str, List[str]]:
    return _assignment_members_by_head_from_edges(
        client.get_all_edges(invitation=invitation_id)
    )


def _paper_assignment_group_ids(
    venue_id: str,
    submission_name: str,
    role_name: str,
    *paper_numbers: int,
) -> List[str]:
    group_ids: List[str] = []
    for paper_number in dict.fromkeys(number for number in paper_numbers if number):
        for group_id in (
            f"{venue_id}/{submission_name}{paper_number}/{role_name}",
            f"{venue_id}/Submission{paper_number}/{role_name}",
            f"{venue_id}/Paper{paper_number}/{role_name}",
        ):
            if group_id not in group_ids:
                group_ids.append(group_id)
    return group_ids


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
    try:
        profiles = client.search_profiles(ids=area_chair_ids)
    except Exception as exc:
        _raise_if_authentication_error(exc)
        logger.warning("Could not load area-chair profiles in bulk", exc_info=True)
        profiles = []

    profiles_by_id = {
        str(profile.id): profile
        for profile in profiles
        if getattr(profile, "id", None)
    }
    contacts: Dict[str, Dict[str, str]] = {}
    for area_chair_id in area_chair_ids:
        profile = profiles_by_id.get(area_chair_id)
        edge_email = preferred_email_by_profile_id.get(area_chair_id, "")
        contacts[area_chair_id] = {
            "name": (
                _profile_display_name(profile, area_chair_id)
                if profile is not None
                else _profile_id_to_display_name(area_chair_id)
            ),
            "email": (
                edge_email
                if _is_usable_email(edge_email)
                else _profile_email(profile) if profile is not None else ""
            ),
        }

    logger.warning(
        "Dashboard load phase area_chair_contacts completed in %.2fs: requested=%s profiles=%s contacts=%s emails=%s",
        time.perf_counter() - started_at,
        len(area_chair_ids),
        len(profiles_by_id),
        len(contacts),
        sum(1 for contact in contacts.values() if contact.get("email")),
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
            venue_content = dict(getattr(venue_group, "content", {}) or {})
            submission_name = _content_value(venue_content.get("submission_name"), "Submission")
            preferred_emails_invitation_id = (
                _content_value(venue_content.get("preferred_emails_id"), "").strip()
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
                venue_content=venue_content,
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
                    "Fetching assigned submissions and replies in batches...",
                    0,
                    len(assigned_numbers),
                )
            phase_started_at = time.perf_counter()
            try:
                submissions = _load_notes_by_numbers_with_replies(
                    client,
                    f"{venue_id}/-/{submission_name}",
                    assigned_numbers,
                )
            except Exception as exc:
                _raise_if_authentication_error(exc)
                raise DashboardFetchError(f"Could not load assigned submissions for venue '{venue_id}'.") from exc
            if progress_callback:
                progress_callback(
                    "submissions",
                    f"Loaded {len(submissions)} assigned submissions and their replies.",
                    len(assigned_numbers),
                    len(assigned_numbers),
                )
            logger.warning(
                (
                    "Dashboard load phase assigned_submission_batches completed in %.2fs for %s: "
                    "assignments=%s submissions=%s requests_at_most=%s"
                ),
                time.perf_counter() - phase_started_at,
                viewer_id,
                len(assigned_numbers),
                len(submissions),
                (len(assigned_numbers) + OPENREVIEW_NOTE_BATCH_SIZE - 1) // OPENREVIEW_NOTE_BATCH_SIZE,
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
            replies = list(((getattr(submission, "details", {}) or {}).get("replies", []) or []))
            return {
                "number": int(submission.number),
                "id": submission.id,
                "prefix": prefix,
                "sac_group": sac_group,
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
            collected_replies += int(candidate["reply_count"])

        all_scoped_candidates = candidate_submissions + withdrawn_candidate_submissions
        collected_replies += sum(
            int(candidate["reply_count"])
            for candidate in withdrawn_candidate_submissions
        )

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
                raise DashboardFetchError(
                    f"Could not load assignment groups in bulk for venue '{venue_id}'."
                ) from exc

        def resolve_group_members(group_id: str) -> List[str]:
            group = paper_groups_by_id.get(group_id)
            if group is None:
                raise DashboardFetchError(
                    f"OpenReview's bulk response did not include assignment group '{group_id}'."
                )
            members, fully_resolved = _resolve_bulk_group_members(group, bulk_groups_by_id)
            if not fully_resolved:
                raise DashboardFetchError(
                    f"OpenReview's bulk response could not resolve anonymous members for assignment group '{group_id}'."
                )
            return members

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
                "bulk_groups_matched=%s"
            ),
            scan_seconds + bulk_group_seconds,
            viewer_id,
            len(collected_submissions),
            len(collected_withdrawn_submissions),
            skipped_withdrawn,
            skipped_desk_rejected,
            skipped_out_of_scope,
            collected_replies,
            bulk_group_seconds,
            bulk_groups_fetched,
            bulk_groups_matched,
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
        venue_content: Dict[str, Any],
        profile: Dict[str, Any],
        viewer_id: str,
        load_started_at: float,
        progress_callback: ProgressCallback | None = None,
    ) -> Dict[str, Any]:
        paper_entry_invitation = f"{venue_id}/-/{submission_name}"
        uses_direct_assignment_edges = _content_bool(venue_content.get("sac_paper_assignments"))
        sac_assignment_invitation_id = _content_value(
            venue_content.get("senior_area_chairs_assignment_id"),
            "",
        ).strip()
        area_chair_assignment_invitation_id = _content_value(
            venue_content.get("area_chairs_assignment_id"),
            "",
        ).strip()
        commitment_notes: List[Any]
        assigned_commitment_note_ids: set[str] = set()
        my_assignment_groups: set[str] = set()
        my_author_groups: set[str] = set()
        has_venue_level_assignment = False
        direct_area_chairs_by_note_id: Dict[str, List[str]] | None = None

        if uses_direct_assignment_edges:
            # Commitment venues represent ARR SACs as OpenReview Area Chairs.
            # Keep Senior Area Chairs as a compatibility fallback for older setups.
            ordered_role_assignment_candidates = [
                ("Area_Chairs", area_chair_assignment_invitation_id),
                ("Senior_Area_Chairs", sac_assignment_invitation_id),
            ]
            role_assignment_candidates: List[tuple[str, str]] = []
            seen_assignment_invitation_ids: set[str] = set()
            for role_name, invitation_id in ordered_role_assignment_candidates:
                if invitation_id and invitation_id not in seen_assignment_invitation_ids:
                    role_assignment_candidates.append((role_name, invitation_id))
                    seen_assignment_invitation_ids.add(invitation_id)
            if not role_assignment_candidates:
                raise DashboardFetchError(
                    f"Venue '{venue_id}' enables direct paper assignments but does not publish an AC or SAC assignment ID."
                )
            try:
                if progress_callback:
                    progress_callback("scope", "Resolving your direct commitment assignments...", 0, 0)
                phase_started_at = time.perf_counter()
                selected_assignment_edges: List[Any] = []
                selected_role_name = ""
                attempted_roles: List[str] = []
                for role_name, invitation_id in role_assignment_candidates:
                    role_edges = client.get_all_edges(
                        invitation=invitation_id,
                        tail=viewer_id,
                    )
                    role_note_ids = {
                        str(getattr(edge, "head", "") or "").strip()
                        for edge in role_edges
                        if str(getattr(edge, "head", "") or "").strip()
                    }
                    attempted_roles.append(f"{role_name}:{len(role_note_ids)}")
                    if not role_note_ids:
                        continue

                    selected_assignment_edges = list(role_edges)
                    selected_role_name = role_name
                    assigned_commitment_note_ids = role_note_ids
                    my_assignment_groups.add(f"{venue_id}/{role_name}")
                    my_assignment_groups.add(viewer_id)
                    if role_name == "Area_Chairs":
                        direct_area_chairs_by_note_id = _assignment_members_by_head_from_edges(
                            selected_assignment_edges
                        )
                    break

                commitment_notes_by_id = _load_notes_by_ids(client, assigned_commitment_note_ids)
                missing_note_ids = assigned_commitment_note_ids - set(commitment_notes_by_id)
                if missing_note_ids:
                    raise DashboardFetchError(
                        "OpenReview's direct SAC assignments referenced commitment entries that were not returned "
                        f"({len(missing_note_ids)} missing)."
                    )
                commitment_notes = [
                    commitment_notes_by_id[note_id]
                    for note_id in assigned_commitment_note_ids
                ]
                logger.warning(
                    (
                        "Dashboard load phase commitment_direct_assignments completed in %.2fs for %s: "
                        "role=%s edges=%s entries=%s attempts=%s"
                    ),
                    time.perf_counter() - phase_started_at,
                    viewer_id,
                    selected_role_name or "none",
                    len(selected_assignment_edges),
                    len(commitment_notes),
                    ",".join(attempted_roles),
                )
            except DashboardFetchError:
                raise
            except Exception as exc:
                _raise_if_authentication_error(exc)
                raise DashboardFetchError(
                    f"Could not load direct commitment paper assignments for venue '{venue_id}'."
                ) from exc
        else:
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
                raise DashboardFetchError(
                    f"Could not load commitment paper entries for venue '{venue_id}'."
                ) from exc

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

        commitment_notes.sort(key=lambda note: _safe_note_number(note))
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
            if not uses_direct_assignment_edges and batch_author_match and not batch_assignment_match:
                skipped_author_entries += 1
                skipped_out_of_scope += 1
                skipped_out_of_scope_before_forum_load += 1
                continue

            if (
                not uses_direct_assignment_edges
                and my_assignment_groups
                and batch_readers
                and not batch_assignment_match
                and not has_venue_level_assignment
            ):
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

        area_chairs_by_note_id: Dict[str, List[str]] | None = direct_area_chairs_by_note_id
        commitment_groups_by_id: Dict[str, Any] = {}
        if commitment_candidates:
            # Reviewer assignment totals are not displayed or exported in commitment mode.
            # Avoid spending quota and transferring the venue-wide reviewer edge set.
            if area_chair_assignment_invitation_id and area_chairs_by_note_id is None:
                try:
                    phase_started_at = time.perf_counter()
                    area_chairs_by_note_id = _assignment_members_by_head(
                        client,
                        area_chair_assignment_invitation_id,
                    )
                    logger.warning(
                        "Dashboard load phase commitment_area_chair_edges completed in %.2fs for %s: papers=%s",
                        time.perf_counter() - phase_started_at,
                        viewer_id,
                        len(area_chairs_by_note_id),
                    )
                except Exception as exc:
                    _raise_if_authentication_error(exc)
                    raise DashboardFetchError(
                        f"Could not load area-chair assignments in bulk for venue '{venue_id}'."
                    ) from exc

            if area_chairs_by_note_id is None:
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
                    raise DashboardFetchError(
                        f"Could not load commitment assignment groups in bulk for venue '{venue_id}'."
                    ) from exc

        prefetched_forum_notes: Dict[str, Any] = {}
        if commitment_candidates:
            if progress_callback:
                progress_callback(
                    "papers",
                    "Loading linked commitment paper forums in batches...",
                    0,
                    len(commitment_candidates),
                )
            phase_started_at = time.perf_counter()
            try:
                prefetched_forum_notes = _load_notes_by_ids_with_replies(
                    client,
                    (str(candidate["forum_id"]) for candidate in commitment_candidates),
                )
                logger.warning(
                    "Dashboard load phase commitment_forum_batches completed in %.2fs for %s: requested=%s loaded=%s",
                    time.perf_counter() - phase_started_at,
                    viewer_id,
                    len(commitment_candidates),
                    len(prefetched_forum_notes),
                )
            except Exception as exc:
                _raise_if_authentication_error(exc)
                raise DashboardFetchError(
                    f"Could not load linked paper forums for venue '{venue_id}'."
                ) from exc

        def load_commitment_candidate(candidate: Dict[str, Any]) -> Dict[str, Any]:
            batch_note = candidate["batch_note"]
            batch_readers = candidate["batch_readers"]
            forum_id = str(candidate["forum_id"])
            commitment_url = str(candidate["commitment_url"])
            note_number = int(candidate["note_number"])

            forum_note = prefetched_forum_notes.get(forum_id)
            if forum_note is None:
                logger.warning(
                    "Skipping commitment entry %s because linked forum %s was absent from the batch response",
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
            if not uses_direct_assignment_edges and reader_author_match and not reader_assignment_match:
                return {"status": "author"}

            if (
                not uses_direct_assignment_edges
                and my_assignment_groups
                and not reader_assignment_match
                and not has_venue_level_assignment
            ):
                return {"status": "out_of_scope"}

            effective_readers = set(readers)
            if uses_direct_assignment_edges:
                effective_readers.add(viewer_id)
            elif has_venue_level_assignment:
                effective_readers.update(my_assignment_groups)
            if not my_assignment_groups:
                effective_readers.add(viewer_id)

            replies = ((getattr(forum_note, "details", {}) or {}).get("replies", []) or [])
            area_chair = self._commitment_area_chair(
                batch_note=batch_note,
                forum_note=forum_note,
                venue_id=venue_id,
                submission_name=submission_name,
                groups_by_id=commitment_groups_by_id,
                assignments_by_note_id=area_chairs_by_note_id,
            )
            reviewers = self._commitment_reviewers(
                batch_note=batch_note,
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

        if commitment_candidates:
            load_started = time.perf_counter()
            for completed, candidate in enumerate(commitment_candidates, start=1):
                if progress_callback:
                    progress_callback(
                        "papers",
                        f"Loaded {completed} of {len(commitment_candidates)} linked paper forums...",
                        completed,
                        len(commitment_candidates),
                    )

                try:
                    result = load_commitment_candidate(candidate)
                except Exception as exc:
                    _raise_if_authentication_error(exc)
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
                "Dashboard load phase commitment_linked_forums completed in %.2fs for %s: candidates=%s kept=%s",
                time.perf_counter() - load_started,
                viewer_id,
                len(commitment_candidates),
                len(collected_submissions),
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
        batch_note: Any,
        forum_note: Any,
        venue_id: str,
        submission_name: str,
        groups_by_id: Dict[str, Any],
        assignments_by_note_id: Dict[str, List[str]] | None = None,
    ) -> str:
        batch_note_id = str(getattr(batch_note, "id", "") or "")
        if assignments_by_note_id is not None:
            assigned_area_chairs = assignments_by_note_id.get(batch_note_id, [])
            return assigned_area_chairs[0] if assigned_area_chairs else ""

        batch_content = getattr(batch_note, "content", {}) or {}
        content_area_chair = _first_content_value(batch_content, ("area_chair", "Area Chair", "area chair"))
        if content_area_chair:
            return content_area_chair

        batch_number = _safe_note_number(batch_note)
        forum_number = _safe_note_number(forum_note)
        if not batch_number and not forum_number:
            return ""

        members = _resolve_group_members(
            _paper_assignment_group_ids(
                venue_id,
                submission_name,
                "Area_Chairs",
                batch_number,
                forum_number,
            ),
            groups_by_id,
            continue_on_empty=True,
        )
        if members:
            return members[0]

        return ""

    def _commitment_reviewers(
        self,
        batch_note: Any,
        forum_note: Any,
        venue_id: str,
        submission_name: str,
        groups_by_id: Dict[str, Any],
    ) -> List[str]:
        batch_number = _safe_note_number(batch_note)
        forum_number = _safe_note_number(forum_note)
        if not batch_number and not forum_number:
            return []

        return _resolve_group_members(
            _paper_assignment_group_ids(
                venue_id,
                submission_name,
                "Reviewers",
                batch_number,
                forum_number,
            ),
            groups_by_id,
        )
