from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.services import openreview_gateway
from app.services.dashboard_logic import build_dashboard_response
from app.services.openreview_gateway import (
    AuthenticationError,
    AuthenticationMfaRequired,
    AuthenticationServiceError,
    DashboardAuthenticationError,
    DashboardFetchError,
    DashboardRateLimitError,
    OpenReviewGateway,
)


class LoginResponse:
    def __init__(self, status_code: int, payload: dict, headers: dict | None = None) -> None:
        self.status_code = status_code
        self.ok = 200 <= status_code < 300
        self.payload = payload
        self.headers = headers or {}

    def json(self):
        return self.payload


class LoginSession:
    def __init__(self, response: LoginResponse) -> None:
        self.response = response
        self.request = lambda method, url, **kwargs: response

    def post(self, url, **kwargs):
        return self.request("POST", url, **kwargs)


def login_client(response: LoginResponse):
    return SimpleNamespace(
        session=LoginSession(response),
        login_url="https://api2.openreview.net/login",
        headers={},
    )


def test_authenticate_rejects_blank_username_before_openreview_client(monkeypatch) -> None:
    monkeypatch.setattr(
        openreview_gateway.openreview.api,
        "OpenReviewClient",
        lambda **kwargs: pytest.fail("OpenReview client must not be created for blank credentials"),
    )

    with pytest.raises(AuthenticationError):
        OpenReviewGateway().authenticate("   ", "password")


def test_authenticate_reports_mfa_without_terminal_prompt(monkeypatch) -> None:
    client = login_client(LoginResponse(200, {"mfaPending": True, "mfaMethods": ["totp"]}))
    monkeypatch.setattr(openreview_gateway.openreview.api, "OpenReviewClient", lambda **kwargs: client)

    with pytest.raises(AuthenticationMfaRequired, match="MFA"):
        OpenReviewGateway().authenticate("sac@example.com", "password")


def test_authenticate_configures_timeout_and_populates_client(monkeypatch) -> None:
    client = login_client(
        LoginResponse(
            200,
            {"token": "token", "user": {"profile": {"id": "~SAC1", "fullname": "SAC One"}}},
        )
    )
    calls = []
    client.session.request = lambda method, url, **kwargs: calls.append((method, url, kwargs)) or client.session.response
    monkeypatch.setattr(openreview_gateway.openreview.api, "OpenReviewClient", lambda **kwargs: client)

    authenticated_client, viewer = OpenReviewGateway().authenticate(" sac@example.com ", "password")

    assert authenticated_client is client
    assert viewer.id == "~SAC1"
    assert client.headers["Authorization"] == "Bearer token"
    assert calls[0][2]["timeout"] == (10, 180)
    assert calls[0][2]["json"]["expiresIn"] == 8 * 60 * 60


def test_gateway_classifies_openreview_401_as_expired_session() -> None:
    class ExpiredClient:
        user = {"profile": {"id": "~SAC1", "fullname": "SAC One"}}

        def get_group(self, group_id: str):
            raise openreview_gateway.openreview.OpenReviewException(
                {"name": "UnauthorizedError", "status": 401, "message": "Token expired"}
            )

    with pytest.raises(DashboardAuthenticationError, match="session expired"):
        OpenReviewGateway().fetch_dashboard_snapshot(
            ExpiredClient(),
            "aclweb.org/ACL/ARR/2026/March",
        )


def test_configured_client_rejects_authenticated_http_401() -> None:
    client = login_client(LoginResponse(401, {}))
    client.token = "expired-token"
    openreview_gateway._configure_client_timeouts(client)

    with pytest.raises(DashboardAuthenticationError, match="session expired"):
        client.session.request("GET", "https://api2.openreview.net/groups")


def test_configured_client_leaves_explicit_login_401_for_authentication_mapping() -> None:
    client = login_client(LoginResponse(401, {}))
    client.token = "token-loaded-from-environment"
    openreview_gateway._configure_client_timeouts(client)

    response = client.session.post(client.login_url, json={"id": "wrong", "password": "wrong"})

    assert response.status_code == 401


def test_configured_client_returns_rate_limits_without_retrying_retry_after() -> None:
    session = openreview_gateway.requests.Session()
    client = SimpleNamespace(
        session=session,
        token="active-token",
        login_url="https://api2.openreview.net/login",
        headers={},
    )

    openreview_gateway._configure_client_timeouts(client)

    retries = session.get_adapter("https://").max_retries
    assert retries.is_retry("GET", 429, has_retry_after=True) is False
    assert retries.is_retry("GET", 503, has_retry_after=False) is True
    session.close()


def test_configured_client_logs_sanitized_quota_headers(caplog) -> None:
    response = LoginResponse(
        200,
        {},
        headers={
            "RateLimit-Limit": "144",
            "RateLimit-Remaining": "103",
            "RateLimit-Reset": "2714",
            "RateLimit-Policy": "144;w=3600",
        },
    )
    client = login_client(response)
    client.token = "active-token"
    openreview_gateway._configure_client_timeouts(client)

    with caplog.at_level("WARNING"):
        client.session.request(
            "GET",
            "https://api2.openreview.net/notes",
            params={"ids": ["private-paper-a", "private-paper-b"], "details": "replies"},
        )

    assert "GET /notes query=ids=2,details=replies" in caplog.text
    assert "limit=144 remaining=103 reset=2714 policy=144;w=3600" in caplog.text
    assert "private-paper-a" not in caplog.text
    assert "active-token" not in caplog.text


def test_quota_metadata_uses_rate_limit_error_details_without_logging_request_id(caplog) -> None:
    response = LoginResponse(
        429,
        {
            "details": {
                "limit": 144,
                "remaining": 0,
                "resetTime": "2026-08-04T08:13:48.767Z",
                "used": 165,
                "current": 165,
                "reqId": "private-request-id",
            }
        },
    )
    client = login_client(response)
    client.token = "active-token"
    openreview_gateway._configure_client_timeouts(client)

    with caplog.at_level("WARNING"):
        client.session.request("GET", "https://api2.openreview.net/groups", params={"id": "private-venue"})

    assert "GET /groups query=id" in caplog.text
    assert "limit=144 remaining=0" in caplog.text
    assert "used=165 current=165" in caplog.text
    assert "private-request-id" not in caplog.text
    assert "private-venue" not in caplog.text


def test_gateway_classifies_openreview_rate_limit_with_utc_reset_time() -> None:
    class RateLimitedClient:
        user = {"profile": {"id": "~SAC1", "fullname": "SAC One"}}

        def get_group(self, group_id: str):
            raise openreview_gateway.openreview.OpenReviewException(
                {
                    "name": "RateLimitError",
                    "status": 429,
                    "message": "Too many requests",
                    "details": {"resetTime": "2026-08-04T08:13:48.767Z"},
                }
            )

    with pytest.raises(
        DashboardRateLimitError,
        match="OpenReview rate limit reached.*2026-08-04 08:13:48 UTC",
    ):
        OpenReviewGateway().fetch_dashboard_snapshot(
            RateLimitedClient(),
            "EMNLP/2026/Conference",
        )


def test_authenticate_maps_upstream_server_failure(monkeypatch) -> None:
    client = login_client(LoginResponse(503, {}))
    monkeypatch.setattr(openreview_gateway.openreview.api, "OpenReviewClient", lambda **kwargs: client)

    with pytest.raises(AuthenticationServiceError, match="503"):
        OpenReviewGateway().authenticate("sac@example.com", "password")


def _raw_note(note: SimpleNamespace) -> dict:
    details = dict(getattr(note, "details", {}) or {})
    if "replies" in details:
        details["replies"] = [_raw_note(reply) for reply in details["replies"]]
    return {
        "number": getattr(note, "number", None),
        "id": getattr(note, "id", ""),
        "forum": getattr(note, "forum", getattr(note, "id", "")),
        "replyto": getattr(note, "replyto", None),
        "readers": list(getattr(note, "readers", []) or []),
        "signatures": list(getattr(note, "signatures", []) or []),
        "invitations": list(getattr(note, "invitations", []) or []),
        "domain": getattr(note, "domain", None),
        "content": dict(getattr(note, "content", {}) or {}),
        "details": details,
        "tcdate": getattr(note, "tcdate", 0) or 0,
    }


class NoteBatchResponse:
    def __init__(self, notes: list[SimpleNamespace]) -> None:
        self.notes = notes

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict:
        return {"notes": [_raw_note(note) for note in self.notes]}


class CommitmentBatchClient:
    def __init__(self) -> None:
        self.session = self
        self.notes_url = "https://api2.openreview.net/notes"
        self.headers = {"Authorization": "Bearer active-token"}
        self.batch_requests: list[dict] = []

    def request(self, method: str, url: str, **kwargs):
        raise AssertionError(f"Unexpected raw request: {method} {url}")

    def get(self, url: str, params: dict, headers: dict):
        assert url == self.notes_url
        assert headers == self.headers
        self.batch_requests.append(params)
        return NoteBatchResponse(
            [self._note_for_batch(note_id) for note_id in params.get("ids", [])]
        )

    def _note_for_batch(self, note_id: str) -> SimpleNamespace:
        raise NotImplementedError


class FakeClient:
    def __init__(self) -> None:
        self.user = {"profile": {"id": "~Test_SAC1", "fullname": "Test SAC"}}
        self.session = self
        self.notes_url = "https://api2.openreview.net/notes"
        self.headers = {"Authorization": "Bearer active-token"}
        self.note_requests: list[tuple[str, str | None, int | None]] = []
        self.batch_note_requests: list[dict] = []
        self.group_requests: list[str] = []
        self.all_group_requests: list[tuple[str | None, str]] = []
        self.grouped_edge_requests: list[tuple[str, str, str]] = []
        self.profile_requests: list[str] = []

    def request(self, method: str, url: str, **kwargs):
        raise AssertionError(f"Unexpected raw request: {method} {url}")

    def get(self, url: str, params: dict, headers: dict):
        assert url == self.notes_url
        assert headers == self.headers
        self.batch_note_requests.append(params)
        requested_numbers = {int(number) for number in params.get("number", [])}
        invitation = str(params.get("invitation") or "")
        notes = self.get_all_notes(invitation=invitation, number=None)
        return NoteBatchResponse([note for note in notes if note.number in requested_numbers])

    def get_group(self, group_id: str):
        self.group_requests.append(group_id)
        if group_id == "aclweb.org/ACL/ARR/2026/March":
            return SimpleNamespace(
                content={
                    "submission_name": {"value": "Submission"},
                    "preferred_emails_id": {"value": "aclweb.org/ACL/ARR/2026/March/-/Preferred_Emails"},
                }
            )
        if group_id == "~Area_ChairShared":
            return SimpleNamespace(members=["area_chairshared@example.com"])
        if group_id.endswith("/Area_Chairs"):
            return SimpleNamespace(members=["~Area_Chair"])
        if group_id.endswith("/Reviewers"):
            return SimpleNamespace(members=["~Reviewer1", "~Reviewer2", "~Reviewer3"])
        raise AssertionError(f"Unexpected group lookup: {group_id}")

    def get_grouped_edges(self, invitation: str, groupby: str, select: str):
        self.grouped_edge_requests.append((invitation, groupby, select))
        assert invitation == "aclweb.org/ACL/ARR/2026/March/-/Preferred_Emails"
        assert groupby == "head"
        assert select == "tail"
        return [
            {
                "id": {"head": "~Area_ChairShared"},
                "values": [{"tail": "preferred-chair@example.com"}],
            }
        ]

    def get_all_groups(self, prefix: str, members: str | None = None):
        assert prefix == "aclweb.org/ACL/ARR/2026/March/Submission"
        self.all_group_requests.append((members, prefix))
        if members is not None:
            assert members == "~Test_SAC1"
            return [
                SimpleNamespace(id="aclweb.org/ACL/ARR/2026/March/Submission42/Senior_Area_Chairs"),
                SimpleNamespace(id="aclweb.org/ACL/ARR/2026/March/Submission77/Senior_Area_Chairs"),
                SimpleNamespace(id="aclweb.org/ACL/ARR/2026/March/Submission99/Senior_Area_Chairs"),
            ]
        return [
            SimpleNamespace(
                id="aclweb.org/ACL/ARR/2026/March/Submission42/Area_Chairs",
                members=["aclweb.org/ACL/ARR/2026/March/Submission42/Area_Chair_ABC"],
                anonids=True,
            ),
            SimpleNamespace(
                id="aclweb.org/ACL/ARR/2026/March/Submission42/Area_Chair_ABC",
                members=["~Area_ChairShared"],
            ),
            SimpleNamespace(
                id="aclweb.org/ACL/ARR/2026/March/Submission42/Reviewers",
                members=[
                    "aclweb.org/ACL/ARR/2026/March/Submission42/Reviewer_X",
                    "aclweb.org/ACL/ARR/2026/March/Submission42/Reviewer_Y",
                    "aclweb.org/ACL/ARR/2026/March/Submission42/Reviewer_Z",
                ],
                anonids=True,
            ),
            SimpleNamespace(
                id="aclweb.org/ACL/ARR/2026/March/Submission42/Reviewer_X",
                members=["~Reviewer1"],
            ),
            SimpleNamespace(
                id="aclweb.org/ACL/ARR/2026/March/Submission42/Reviewer_Y",
                members=["~Reviewer2"],
            ),
            SimpleNamespace(
                id="aclweb.org/ACL/ARR/2026/March/Submission42/Reviewer_Z",
                members=["~Reviewer3"],
            ),
            SimpleNamespace(
                id="aclweb.org/ACL/ARR/2026/March/Submission77/Area_Chairs",
                members=["aclweb.org/ACL/ARR/2026/March/Submission77/Area_Chair_ABC"],
                anonids=True,
            ),
            SimpleNamespace(
                id="aclweb.org/ACL/ARR/2026/March/Submission77/Area_Chair_ABC",
                members=["~Area_ChairShared"],
            ),
            SimpleNamespace(
                id="aclweb.org/ACL/ARR/2026/March/Submission77/Reviewers",
                members=[
                    "aclweb.org/ACL/ARR/2026/March/Submission77/Reviewer_X",
                    "aclweb.org/ACL/ARR/2026/March/Submission77/Reviewer_Y",
                    "aclweb.org/ACL/ARR/2026/March/Submission77/Reviewer_Z",
                ],
                anonids=True,
            ),
            SimpleNamespace(
                id="aclweb.org/ACL/ARR/2026/March/Submission77/Reviewer_X",
                members=["~Reviewer4"],
            ),
            SimpleNamespace(
                id="aclweb.org/ACL/ARR/2026/March/Submission77/Reviewer_Y",
                members=["~Reviewer5"],
            ),
            SimpleNamespace(
                id="aclweb.org/ACL/ARR/2026/March/Submission77/Reviewer_Z",
                members=["~Reviewer6"],
            ),
            SimpleNamespace(
                id="aclweb.org/ACL/ARR/2026/March/Submission99/Area_Chairs",
                members=["aclweb.org/ACL/ARR/2026/March/Submission99/Area_Chair_ABC"],
                anonids=True,
            ),
            SimpleNamespace(
                id="aclweb.org/ACL/ARR/2026/March/Submission99/Area_Chair_ABC",
                members=["~Area_ChairWithdrawn"],
            ),
        ]

    def get_profile(self, profile_id: str):
        self.profile_requests.append(profile_id)
        display_name = profile_id.strip("~").replace("_", " ")
        return SimpleNamespace(
            id=profile_id,
            content={
                "names": [{"fullname": display_name, "preferred": True}],
                "preferredEmail": "****@example.com",
            },
        )

    def search_profiles(self, ids: list[str]):
        return [self.get_profile(profile_id) for profile_id in ids]

    def get_all_notes(self, invitation: str, details: str | None = None, number: int | None = None):
        assert invitation == "aclweb.org/ACL/ARR/2026/March/-/Submission"
        assert details is None
        self.note_requests.append((invitation, details, number))
        notes = [
            SimpleNamespace(
                number=13,
                id="paper-13",
                readers=["aclweb.org/ACL/ARR/2026/March/Submission13/Senior_Area_Chairs"],
                content={"venue": {"value": "ARR"}, "paper_type": {"value": "Long"}},
                details={"replies": []},
            ),
            SimpleNamespace(
                number=42,
                id="paper-42",
                readers=["aclweb.org/ACL/ARR/2026/March/Submission42/Senior_Area_Chairs"],
                content={"venue": {"value": "ARR"}, "paper_type": {"value": "Long"}},
                details={"replies": []},
            ),
            SimpleNamespace(
                number=77,
                id="paper-77",
                readers=["aclweb.org/ACL/ARR/2026/March/Submission77/Senior_Area_Chairs"],
                content={"venue": {"value": "ARR"}, "paper_type": {"value": "Short"}},
                details={"replies": []},
            ),
            SimpleNamespace(
                number=88,
                id="paper-88",
                readers=["aclweb.org/ACL/ARR/2026/March/Submission88/Senior_Area_Chairs"],
                content={"venue": {"value": "Desk Rejected"}},
                details={"replies": []},
            ),
            SimpleNamespace(
                number=99,
                id="paper-99",
                readers=["aclweb.org/ACL/ARR/2026/March/Submission99/Senior_Area_Chairs"],
                content={"venue": {"value": "ARR"}, "withdrawal_confirmation": {"value": "Yes"}},
                details={"replies": []},
            ),
        ]
        return [note for note in notes if number is None or note.number == number]


def test_gateway_bulk_fetches_assignment_groups_after_filtering_submissions() -> None:
    client = FakeClient()
    phases: list[tuple[str, str, int, int]] = []

    snapshot = OpenReviewGateway().fetch_dashboard_snapshot(
        client,
        "aclweb.org/ACL/ARR/2026/March",
        progress_callback=lambda phase, message, current, total: phases.append((phase, message, current, total)),
    )

    assert client.note_requests == [
        ("aclweb.org/ACL/ARR/2026/March/-/Submission", None, None)
    ]
    assert client.batch_note_requests == [
        {
            "number": [42, 77, 99],
            "limit": 3,
            "invitation": "aclweb.org/ACL/ARR/2026/March/-/Submission",
        }
    ]
    assert [submission["number"] for submission in snapshot["submissions"]] == [42, 77]
    assert snapshot["my_sac_groups"] == [
        "aclweb.org/ACL/ARR/2026/March/Submission42/Senior_Area_Chairs",
        "aclweb.org/ACL/ARR/2026/March/Submission77/Senior_Area_Chairs",
        "aclweb.org/ACL/ARR/2026/March/Submission99/Senior_Area_Chairs",
    ]
    assert snapshot["submissions"][0]["area_chairs"] == ["~Area_ChairShared"]
    assert snapshot["submissions"][1]["area_chairs"] == ["~Area_ChairShared"]
    assert snapshot["submissions"][1]["reviewers"] == ["~Reviewer4", "~Reviewer5", "~Reviewer6"]
    assert snapshot["area_chair_contacts"]["~Area_ChairShared"] == {
        "name": "Area ChairShared",
        "email": "preferred-chair@example.com",
    }
    assert client.grouped_edge_requests == [
        ("aclweb.org/ACL/ARR/2026/March/-/Preferred_Emails", "head", "tail")
    ]
    assert client.profile_requests == ["~Area_ChairShared"]
    assert [submission["number"] for submission in snapshot["withdrawn_submissions"]] == [99]
    assert snapshot["withdrawn_submissions"][0]["area_chairs"] == ["~Area_ChairWithdrawn"]
    assert ("~Test_SAC1", "aclweb.org/ACL/ARR/2026/March/Submission") in client.all_group_requests
    assert (None, "aclweb.org/ACL/ARR/2026/March/Submission") in client.all_group_requests
    assert "aclweb.org/ACL/ARR/2026/March/Submission42/Area_Chairs" not in client.group_requests
    assert "aclweb.org/ACL/ARR/2026/March/Submission77/Area_Chairs" not in client.group_requests
    assert "aclweb.org/ACL/ARR/2026/March/Submission13/Area_Chairs" not in client.group_requests
    assert phases[0][0] == "venue"
    assert any(phase[0] == "submissions" for phase in phases)
    assert any(phase[0] == "scope" for phase in phases)
    assert any(phase[0] == "papers" and phase[3] == 3 for phase in phases)
    assert any(phase[0] == "groups" and phase[3] == 3 for phase in phases)


def test_gateway_loads_sixty_arr_papers_with_bounded_forum_reply_streams() -> None:
    venue_id = "aclweb.org/ACL/ARR/2026/May"
    submission_invitation = f"{venue_id}/-/Submission"

    class LargeArrClient:
        def __init__(self) -> None:
            self.user = {"profile": {"id": "~Test_SAC1", "fullname": "Test SAC"}}
            self.session = self
            self.notes_url = "https://api2.openreview.net/notes"
            self.headers = {"Authorization": "Bearer active-token"}
            self.request_count = 0
            self.batch_note_requests: list[dict] = []
            self.profile_batches: list[list[str]] = []
            self.forum_note_requests: list[tuple[list[str], bool]] = []

        def request(self, method: str, url: str, **kwargs):
            raise AssertionError(f"Unexpected raw request: {method} {url}")

        def get(self, url: str, params: dict, headers: dict):
            self.request_count += 1
            assert url == self.notes_url
            assert headers == self.headers
            self.batch_note_requests.append(params)
            return NoteBatchResponse(
                [
                    SimpleNamespace(
                        number=int(number),
                        id=f"paper-{number}",
                        domain=venue_id,
                        readers=[f"{venue_id}/Submission{number}/Senior_Area_Chairs"],
                        content={"venue": {"value": "ARR"}, "paper_type": {"value": "Long"}},
                        details={"replies": []},
                    )
                    for number in params["number"]
                ]
            )

        def get_group(self, group_id: str):
            self.request_count += 1
            assert group_id == venue_id
            return SimpleNamespace(
                content={
                    "submission_name": {"value": "Submission"},
                    "preferred_emails_id": {"value": f"{venue_id}/-/Preferred_Emails"},
                }
            )

        def get_all_groups(self, prefix: str, members: str | None = None):
            self.request_count += 1
            assert prefix == f"{venue_id}/Submission"
            if members is not None:
                assert members == "~Test_SAC1"
                return [
                    SimpleNamespace(id=f"{venue_id}/Submission{number}/Senior_Area_Chairs")
                    for number in range(1, 61)
                ]
            return [
                group
                for number in range(1, 61)
                for group in (
                    SimpleNamespace(
                        id=f"{venue_id}/Submission{number}/Area_Chairs",
                        members=["~Area_Chair1"],
                    ),
                    SimpleNamespace(
                        id=f"{venue_id}/Submission{number}/Reviewers",
                        members=[f"~Reviewer{number}_1", f"~Reviewer{number}_2", f"~Reviewer{number}_3"],
                    ),
                )
            ]

        def get_notes(self, forum: list[str], stream: bool):
            self.request_count += 1
            self.forum_note_requests.append((forum, stream))
            assert stream is True
            return [
                SimpleNamespace(
                    id="review-1",
                    forum="paper-1",
                    replyto="paper-1",
                    readers=["everyone"],
                    signatures=["~Reviewer1"],
                    invitations=[f"{venue_id}/Submission1/-/Official_Review"],
                    content={"overall_assessment": {"value": "4 Strong accept"}},
                    tcdate=1712188800000,
                )
            ]

        def get_grouped_edges(self, invitation: str, groupby: str, select: str):
            self.request_count += 1
            assert invitation == f"{venue_id}/-/Preferred_Emails"
            assert groupby == "head"
            assert select == "tail"
            return [
                {
                    "id": {"head": "~Area_Chair1"},
                    "values": [{"tail": "area-chair@example.com"}],
                }
            ]

        def search_profiles(self, ids: list[str]):
            self.request_count += 1
            self.profile_batches.append(ids)
            return [
                SimpleNamespace(
                    id="~Area_Chair1",
                    content={"names": [{"fullname": "Area Chair", "preferred": True}]},
                )
            ]

    client = LargeArrClient()

    snapshot = OpenReviewGateway().fetch_dashboard_snapshot(client, venue_id)

    assert client.request_count == 9
    assert [len(request["number"]) for request in client.batch_note_requests] == [50, 10]
    assert all("details" not in request for request in client.batch_note_requests)
    assert [len(request[0]) for request in client.forum_note_requests] == [50, 10]
    assert client.forum_note_requests[0][0] == [f"paper-{number}" for number in range(1, 51)]
    assert client.forum_note_requests[1][0] == [f"paper-{number}" for number in range(51, 61)]
    assert all(request[1] is True for request in client.forum_note_requests)
    assert client.profile_batches == [["~Area_Chair1"]]
    assert len(snapshot["submissions"]) == 60
    assert snapshot["submissions"][0]["replies"][0]["id"] == "review-1"
    assert snapshot["area_chair_contacts"]["~Area_Chair1"]["email"] == "area-chair@example.com"


def test_gateway_keeps_public_readable_submission_when_viewer_has_sac_group() -> None:
    class PublicReaderClient(FakeClient):
        def get_all_groups(self, prefix: str, members: str | None = None):
            groups = super().get_all_groups(prefix=prefix, members=members)
            if members is None:
                return [
                    *groups,
                    SimpleNamespace(
                        id="aclweb.org/ACL/ARR/2026/March/Submission101/Area_Chairs",
                        members=["~Area_ChairPublic"],
                    ),
                    SimpleNamespace(
                        id="aclweb.org/ACL/ARR/2026/March/Submission101/Reviewers",
                        members=["~ReviewerPublic"],
                    ),
                ]
            return [
                *groups,
                SimpleNamespace(id="aclweb.org/ACL/ARR/2026/March/Submission101/Senior_Area_Chairs"),
            ]

        def get_all_notes(
            self,
            invitation: str,
            details: str | None = None,
            number: int | None = None,
        ):
            notes = super().get_all_notes(invitation=invitation, details=details, number=number)
            if number is None or number == 101:
                notes.append(SimpleNamespace(
                    number=101,
                    id="paper-101",
                    readers=["everyone"],
                    content={"venue": {"value": "ARR"}, "paper_type": {"value": "Long"}},
                    details={"replies": []},
                ))
            return notes

    snapshot = OpenReviewGateway().fetch_dashboard_snapshot(
        PublicReaderClient(),
        "aclweb.org/ACL/ARR/2026/March",
    )

    assert [submission["number"] for submission in snapshot["submissions"]] == [42, 77, 101]
    public_submission = snapshot["submissions"][2]
    assert public_submission["readers"] == ["everyone"]
    assert public_submission["sac_group"] == (
        "aclweb.org/ACL/ARR/2026/March/Submission101/Senior_Area_Chairs"
    )


def test_gateway_fails_without_per_paper_lookup_when_bulk_group_is_missing() -> None:
    class MissingBulkGroupClient(FakeClient):
        def get_all_groups(self, prefix: str, members: str | None = None):
            groups = super().get_all_groups(prefix=prefix, members=members)
            if members is not None:
                return groups
            return [
                group
                for group in groups
                if group.id != "aclweb.org/ACL/ARR/2026/March/Submission77/Reviewers"
            ]

    client = MissingBulkGroupClient()

    with pytest.raises(DashboardFetchError, match="bulk response did not include assignment group"):
        OpenReviewGateway().fetch_dashboard_snapshot(client, "aclweb.org/ACL/ARR/2026/March")

    assert "aclweb.org/ACL/ARR/2026/March/Submission77/Reviewers" not in client.group_requests
    assert "aclweb.org/ACL/ARR/2026/March/Submission77/Area_Chairs" not in client.group_requests


def test_gateway_fails_without_per_paper_lookup_when_bulk_anonymous_mapping_is_missing() -> None:
    class MissingAnonMappingClient(FakeClient):
        def get_all_groups(self, prefix: str, members: str | None = None):
            groups = super().get_all_groups(prefix=prefix, members=members)
            if members is not None:
                return groups
            return [
                group
                for group in groups
                if group.id != "aclweb.org/ACL/ARR/2026/March/Submission77/Area_Chair_ABC"
            ]

    client = MissingAnonMappingClient()

    with pytest.raises(DashboardFetchError, match="could not resolve anonymous members"):
        OpenReviewGateway().fetch_dashboard_snapshot(client, "aclweb.org/ACL/ARR/2026/March")

    assert "aclweb.org/ACL/ARR/2026/March/Submission77/Area_Chairs" not in client.group_requests


def test_gateway_fails_closed_when_assignment_group_cannot_be_loaded() -> None:
    class FailingGroupClient(FakeClient):
        def get_all_groups(self, prefix: str, members: str | None = None):
            if members is not None:
                return super().get_all_groups(prefix=prefix, members=members)
            raise RuntimeError("OpenReview unavailable")

    with pytest.raises(DashboardFetchError, match="Could not load assignment groups in bulk"):
        OpenReviewGateway().fetch_dashboard_snapshot(
            FailingGroupClient(),
            "aclweb.org/ACL/ARR/2026/March",
        )


def test_gateway_normalizes_reply_objects_to_plain_dicts() -> None:
    class ReplyClient(FakeClient):
        def get_all_notes(
            self,
            invitation: str,
            details: str | None = None,
            number: int | None = None,
        ):
            assert invitation == "aclweb.org/ACL/ARR/2026/March/-/Submission"
            assert details is None
            self.note_requests.append((invitation, details, number))
            if number not in (None, 42):
                return []
            return [
                SimpleNamespace(
                    number=42,
                    id="paper-42",
                    readers=["aclweb.org/ACL/ARR/2026/March/Submission42/Senior_Area_Chairs"],
                    content={"venue": {"value": "ARR"}, "paper_type": {"value": "Long"}},
                    details={
                        "replies": [
                            SimpleNamespace(
                                id="reply-1",
                                forum="paper-42",
                                replyto="paper-42",
                                readers=["everyone"],
                                signatures=["~Reviewer1"],
                                invitations=["aclweb.org/ACL/ARR/2026/March/Submission42/-/Official_Review"],
                                content={"overall_assessment": {"value": "4 Strong accept"}},
                                tcdate=1712188800000,
                            )
                        ]
                    },
                )
            ]

    snapshot = OpenReviewGateway().fetch_dashboard_snapshot(ReplyClient(), "aclweb.org/ACL/ARR/2026/March")

    reply = snapshot["submissions"][0]["replies"][0]
    assert isinstance(reply, dict)
    assert reply["id"] == "reply-1"
    assert reply["signatures"] == ["~Reviewer1"]


def test_gateway_loads_commitment_entries_from_linked_forums() -> None:
    class CommitmentClient:
        def __init__(self) -> None:
            self.user = {"profile": {"id": "~Test_SAC1", "fullname": "Test SAC"}}
            self.session = self
            self.notes_url = "https://api2.openreview.net/notes"
            self.headers = {"Authorization": "Bearer active-token"}
            self.note_requests: list[str] = []
            self.forum_requests: list[tuple[str, str]] = []
            self.batch_requests: list[dict] = []
            self.group_requests: list[str] = []
            self.all_group_requests: list[tuple[str | None, str]] = []

        def request(self, method: str, url: str, **kwargs):
            raise AssertionError(f"Unexpected raw request: {method} {url}")

        def get(self, url: str, params: dict, headers: dict):
            assert url == self.notes_url
            assert headers == self.headers
            self.batch_requests.append(params)

            class BatchResponse:
                @staticmethod
                def raise_for_status() -> None:
                    return None

                @staticmethod
                def json() -> dict:
                    return {
                        "notes": [
                            {
                                "number": 42,
                                "id": "arr-paper-42",
                                "forum": "arr-paper-42",
                                "readers": ["everyone"],
                                "content": {
                                    "venue": {"value": "ACL ARR 2026 March"},
                                    "title": {"value": "Committed Work on Review Monitoring"},
                                    "paper_type": {"value": "Long"},
                                    "Previous URL": {
                                        "value": "https://openreview.net/forum?id=previous-arr-paper"
                                    },
                                },
                                "details": {
                                    "replies": [
                                        {
                                            "id": "review-1",
                                            "forum": "arr-paper-42",
                                            "replyto": "arr-paper-42",
                                            "readers": ["everyone"],
                                            "signatures": ["~Reviewer1"],
                                            "invitations": [
                                                "aclweb.org/ACL/ARR/2026/March/Submission42/-/Official_Review"
                                            ],
                                            "content": {"overall_assessment": {"value": "4 Strong accept"}},
                                            "tcdate": 1712188800000,
                                        }
                                    ]
                                },
                            }
                        ]
                    }

            return BatchResponse()

        def get_group(self, group_id: str):
            self.group_requests.append(group_id)
            if group_id == "aclweb.org/ACL/2026/Conference":
                return SimpleNamespace(content={"submission_name": {"value": "Commitment"}})
            raise AssertionError(f"Unexpected group lookup: {group_id}")

        def get_all_groups(self, prefix: str, members: str | None = None):
            assert prefix == "aclweb.org/ACL/2026/Conference"
            self.all_group_requests.append((members, prefix))
            if members is None:
                return [
                    SimpleNamespace(
                        id="aclweb.org/ACL/2026/Conference/Commitment42/Reviewers",
                        members=["~Reviewer1", "~Reviewer2"],
                    )
                ]
            assert members == "~Test_SAC1"
            return [
                SimpleNamespace(id="aclweb.org/ACL/2026/Conference/Area_Chairs"),
                SimpleNamespace(id="aclweb.org/ACL/2026/Conference/Authors"),
            ]

        def get_all_notes(self, invitation: str, details: str | None = None):
            assert invitation == "aclweb.org/ACL/2026/Conference/-/Commitment"
            assert details is None
            self.note_requests.append(invitation)
            return [
                SimpleNamespace(
                    number=7,
                    id="commitment-7",
                    readers=[
                        "aclweb.org/ACL/2026/Conference/Area_Chairs",
                        "aclweb.org/ACL/2026/Conference/Authors",
                    ],
                    content={
                        "paper_link": {"value": "https://openreview.net/forum?id=arr-paper-42"},
                        "area_chair": {"value": "~Area_ChairCommitment"},
                    },
                    details={
                        "replies": [
                            SimpleNamespace(
                                id="commitment-meta-review-1",
                                forum="commitment-7",
                                replyto="commitment-7",
                                readers=["aclweb.org/ACL/2026/Conference/Area_Chairs"],
                                signatures=[
                                    "aclweb.org/ACL/2026/Conference/Commitment7/Area_Chair_1"
                                ],
                                invitations=[
                                    "aclweb.org/ACL/2026/Conference/Commitment7/-/Meta_Review"
                                ],
                                content={"recommendation": {"value": "Accept"}},
                                tcdate=1712188800000,
                            )
                        ]
                    },
                )
            ]

        def get_note(self, note_id: str, details: str):
            self.forum_requests.append((note_id, details))
            assert note_id == "arr-paper-42"
            assert details == "replies"
            return SimpleNamespace(
                number=42,
                id="arr-paper-42",
                readers=["everyone"],
                content={
                    "venue": {"value": "ACL ARR 2026 March"},
                    "title": {"value": "Committed Work on Review Monitoring"},
                    "paper_type": {"value": "Long"},
                    "Previous URL": {"value": "https://openreview.net/forum?id=previous-arr-paper"},
                },
                details={
                    "replies": [
                        SimpleNamespace(
                            id="review-1",
                            forum="arr-paper-42",
                            replyto="arr-paper-42",
                            readers=["everyone"],
                            signatures=["~Reviewer1"],
                            invitations=["aclweb.org/ACL/ARR/2026/March/Submission42/-/Official_Review"],
                            content={"overall_assessment": {"value": "4 Strong accept"}},
                            tcdate=1712188800000,
                        )
                    ]
                },
            )

    client = CommitmentClient()

    snapshot = OpenReviewGateway().fetch_dashboard_snapshot(client, "aclweb.org/ACL/2026/Conference")

    assert client.note_requests == ["aclweb.org/ACL/2026/Conference/-/Commitment"]
    assert client.forum_requests == []
    assert client.batch_requests == [
        {"ids": ["arr-paper-42"], "limit": 1}
    ]
    assert (None, "aclweb.org/ACL/2026/Conference") in client.all_group_requests
    assert "aclweb.org/ACL/2026/Conference/Commitment42/Reviewers" not in client.group_requests
    assert snapshot["my_sac_groups"] == ["aclweb.org/ACL/2026/Conference/Area_Chairs"]
    assert len(snapshot["submissions"]) == 1
    submission = snapshot["submissions"][0]
    assert submission["number"] == 7
    assert submission["id"] == "arr-paper-42"
    assert submission["forum_url"] == "https://openreview.net/forum?id=commitment-7"
    assert submission["area_chairs"] == ["~Area_ChairCommitment"]
    assert submission["reviewers"] == ["~Reviewer1", "~Reviewer2"]
    assert submission["content"]["title"]["value"] == "Committed Work on Review Monitoring"
    assert submission["content"]["Previous URL"]["value"] == "https://openreview.net/forum?id=previous-arr-paper"
    assert submission["replies"][0]["id"] == "review-1"
    assert submission["commitment_replies"][0]["id"] == "commitment-meta-review-1"


def test_gateway_loads_forty_direct_commitments_without_venue_wide_assignment_queries() -> None:
    venue_id = "EMNLP/2026/Conference"
    sac_assignment_id = f"{venue_id}/Senior_Area_Chairs/-/Assignment"
    area_chair_assignment_id = f"{venue_id}/Area_Chairs/-/Assignment"
    reviewer_assignment_id = f"{venue_id}/Reviewers/-/Assignment"

    class DirectCommitmentClient(CommitmentBatchClient):
        def __init__(self) -> None:
            super().__init__()
            self.user = {"profile": {"id": "~Test_SAC1", "fullname": "Test SAC"}}
            self.request_count = 0
            self.edge_requests: list[tuple[str, str | None]] = []
            self.note_stream_requests: list[dict] = []

        def get(self, url: str, params: dict, headers: dict):
            self.request_count += 1
            return super().get(url, params, headers)

        def get_group(self, group_id: str):
            self.request_count += 1
            assert group_id == venue_id
            return SimpleNamespace(
                content={
                    "submission_name": {"value": "Submission"},
                    "sac_paper_assignments": {"value": True},
                    "senior_area_chairs_assignment_id": {"value": sac_assignment_id},
                    "area_chairs_assignment_id": {"value": area_chair_assignment_id},
                    "reviewers_assignment_id": {"value": reviewer_assignment_id},
                }
            )

        def get_all_edges(self, invitation: str, tail: str | None = None):
            self.request_count += 1
            self.edge_requests.append((invitation, tail))
            assert invitation == area_chair_assignment_id
            assert tail == "~Test_SAC1"
            return [
                SimpleNamespace(head=f"commitment-{number}", tail="~Test_SAC1")
                for number in range(1, 41)
            ]

        def get_all_groups(self, *args, **kwargs):
            raise AssertionError("Direct SAC assignments must not use group discovery")

        def get_all_notes(self, *args, **kwargs):
            raise AssertionError("Direct SAC assignments must not load every commitment entry")

        def get_notes(
            self,
            *,
            stream: bool,
            domain: str | None = None,
            forum: list[str] | None = None,
            parent_invitations: str | None = None,
        ):
            self.request_count += 1
            self.note_stream_requests.append(
                {
                    "domain": domain,
                    "forum": forum,
                    "stream": stream,
                    "parent_invitations": parent_invitations,
                }
            )
            assert stream is True
            if parent_invitations is not None:
                assert domain == venue_id
                assert forum is None
                assert parent_invitations == f"{venue_id}/-/Meta_Review"
                return [
                    SimpleNamespace(
                        id="commitment-meta-review-1",
                        forum="commitment-1",
                        replyto="commitment-1",
                        readers=[f"{venue_id}/Area_Chairs"],
                        signatures=[f"{venue_id}/Submission1/Area_Chair_1"],
                        invitations=[f"{venue_id}/Submission1/-/Meta_Review"],
                        content={"recommendation": {"value": "Accept"}},
                        tcdate=1712188800000,
                    )
                ]

            assert domain is None
            assert forum == [f"arr-paper-{number}" for number in range(1, 41)]
            return [
                SimpleNamespace(
                    id="review-1",
                    forum="arr-paper-1",
                    replyto="arr-paper-1",
                    readers=["everyone"],
                    signatures=["~Reviewer1"],
                    invitations=["aclweb.org/ACL/ARR/2026/May/Submission1001/-/Official_Review"],
                    content={"overall_assessment": {"value": "4 Strong accept"}},
                    tcdate=1712188800000,
                )
            ]

        def _note_for_batch(self, note_id: str) -> SimpleNamespace:
            prefix, raw_number = note_id.rsplit("-", 1)
            number = int(raw_number)
            if prefix == "commitment":
                return SimpleNamespace(
                    number=number,
                    id=note_id,
                    readers=[f"{venue_id}/Submission{number}/Area_Chairs"],
                    content={
                        "paper_link": {"value": f"https://openreview.net/forum?id=arr-paper-{number}"}
                    },
                    details={},
                )
            assert prefix == "arr-paper"
            return SimpleNamespace(
                number=1000 + number,
                id=note_id,
                domain="aclweb.org/ACL/ARR/2026/May",
                readers=["everyone"],
                content={
                    "venue": {"value": "ACL ARR 2026 May"},
                    "title": {"value": f"Assigned paper {number}"},
                },
                details={"replies": []},
            )

    client = DirectCommitmentClient()

    snapshot = OpenReviewGateway().fetch_dashboard_snapshot(client, venue_id)
    dashboard = build_dashboard_response(snapshot, venue_id)

    assert client.request_count == 6
    assert client.edge_requests == [
        (area_chair_assignment_id, "~Test_SAC1"),
    ]
    assert len(client.batch_requests) == 2
    assert len(client.batch_requests[0]["ids"]) == 40
    assert "details" not in client.batch_requests[0]
    assert len(client.batch_requests[1]["ids"]) == 40
    assert "details" not in client.batch_requests[1]
    assert client.note_stream_requests == [
        {
            "domain": venue_id,
            "forum": None,
            "stream": True,
            "parent_invitations": f"{venue_id}/-/Meta_Review",
        },
        {
            "domain": None,
            "forum": [f"arr-paper-{number}" for number in range(1, 41)],
            "stream": True,
            "parent_invitations": None,
        },
    ]
    assert len(snapshot["submissions"]) == 40
    assert len(dashboard.papers) == 40
    assert snapshot["submissions"][0]["area_chairs"] == ["~Test_SAC1"]
    assert snapshot["submissions"][0]["reviewers"] == []
    assert dashboard.papers[0].expectedReviews == 0
    assert dashboard.papers[0].recommendationPosted is True
    assert dashboard.papers[1].recommendationPosted is False
    assert snapshot["my_sac_groups"] == [f"{venue_id}/Area_Chairs", "~Test_SAC1"]


def test_gateway_falls_back_to_senior_area_chair_assignments_when_commitment_area_chair_edges_are_empty() -> None:
    venue_id = "EMNLP/2026/Conference"
    sac_assignment_id = f"{venue_id}/Senior_Area_Chairs/-/Assignment"
    area_chair_assignment_id = f"{venue_id}/Area_Chairs/-/Assignment"
    reviewer_assignment_id = f"{venue_id}/Reviewers/-/Assignment"

    class DirectCommitmentFallbackClient(CommitmentBatchClient):
        def __init__(self) -> None:
            super().__init__()
            self.user = {"profile": {"id": "~Test_SAC1", "fullname": "Test SAC"}}
            self.edge_requests: list[tuple[str, str | None]] = []

        def get_group(self, group_id: str):
            assert group_id == venue_id
            return SimpleNamespace(
                content={
                    "submission_name": {"value": "Submission"},
                    "sac_paper_assignments": {"value": True},
                    "senior_area_chairs_assignment_id": {"value": sac_assignment_id},
                    "area_chairs_assignment_id": {"value": area_chair_assignment_id},
                    "reviewers_assignment_id": {"value": reviewer_assignment_id},
                }
            )

        def get_all_edges(self, invitation: str, tail: str | None = None):
            self.edge_requests.append((invitation, tail))
            if invitation == area_chair_assignment_id and tail == "~Test_SAC1":
                return []
            if invitation == sac_assignment_id and tail == "~Test_SAC1":
                return [SimpleNamespace(head="commitment-1", tail="~Test_SAC1")]
            if invitation == area_chair_assignment_id and tail is None:
                return [SimpleNamespace(head="commitment-1", tail="~Assigned_AC1")]
            raise AssertionError(f"Unexpected assignment request: {invitation}, tail={tail}")

        def get_all_groups(self, *args, **kwargs):
            raise AssertionError("Direct assignments must not use group discovery")

        def get_all_notes(self, *args, **kwargs):
            raise AssertionError("Direct assignments must not load every commitment entry")

        def _note_for_batch(self, note_id: str) -> SimpleNamespace:
            if note_id == "commitment-1":
                return SimpleNamespace(
                    number=1,
                    id=note_id,
                    readers=[f"{venue_id}/Submission1/Senior_Area_Chairs"],
                    content={
                        "paper_link": {"value": "https://openreview.net/forum?id=arr-paper-1"}
                    },
                    details={},
                )
            assert note_id == "arr-paper-1"
            return SimpleNamespace(
                number=101,
                id=note_id,
                readers=["everyone"],
                content={"venue": {"value": "ACL ARR 2026 May"}},
                details={"replies": []},
            )

    client = DirectCommitmentFallbackClient()

    snapshot = OpenReviewGateway().fetch_dashboard_snapshot(client, venue_id)

    assert client.edge_requests == [
        (area_chair_assignment_id, "~Test_SAC1"),
        (sac_assignment_id, "~Test_SAC1"),
        (area_chair_assignment_id, None),
    ]
    assert len(snapshot["submissions"]) == 1
    assert snapshot["submissions"][0]["area_chairs"] == ["~Assigned_AC1"]
    assert snapshot["submissions"][0]["reviewers"] == []
    assert snapshot["my_sac_groups"] == [f"{venue_id}/Senior_Area_Chairs", "~Test_SAC1"]


def test_gateway_continues_commitment_area_chair_lookup_after_empty_bulk_group() -> None:
    class CommitmentAreaChairFallbackClient(CommitmentBatchClient):
        def __init__(self) -> None:
            super().__init__()
            self.user = {"profile": {"id": "~Test_SAC1", "fullname": "Test SAC"}}
            self.all_group_requests: list[tuple[str | None, str]] = []
            self.group_requests: list[str] = []

        def get_group(self, group_id: str):
            self.group_requests.append(group_id)
            if group_id == "aclweb.org/ACL/2026/Conference":
                return SimpleNamespace(content={"submission_name": {"value": "Commitment"}})
            raise AssertionError(f"Unexpected group lookup: {group_id}")

        def get_all_groups(self, prefix: str, members: str | None = None):
            assert prefix == "aclweb.org/ACL/2026/Conference"
            self.all_group_requests.append((members, prefix))
            if members is None:
                return [
                    SimpleNamespace(
                        id="aclweb.org/ACL/2026/Conference/Commitment42/Area_Chairs",
                        members=[],
                    ),
                    SimpleNamespace(
                        id="aclweb.org/ACL/2026/Conference/Submission42/Area_Chairs",
                        members=["~Fallback_AC1"],
                    ),
                    SimpleNamespace(
                        id="aclweb.org/ACL/2026/Conference/Commitment42/Reviewers",
                        members=["~Reviewer1"],
                    ),
                ]
            assert members == "~Test_SAC1"
            return [SimpleNamespace(id="aclweb.org/ACL/2026/Conference/Area_Chairs")]

        def get_all_notes(self, invitation: str, details: str | None = None):
            assert invitation == "aclweb.org/ACL/2026/Conference/-/Commitment"
            assert details is None
            return [
                SimpleNamespace(
                    number=7,
                    id="commitment-7",
                    readers=["everyone"],
                    content={"paper_link": {"value": "https://openreview.net/forum?id=arr-paper-42"}},
                )
            ]

        def _note_for_batch(self, note_id: str) -> SimpleNamespace:
            assert note_id == "arr-paper-42"
            return SimpleNamespace(
                number=42,
                id="arr-paper-42",
                readers=["everyone"],
                content={"venue": {"value": "ACL ARR 2026 March"}},
                details={"replies": []},
            )

    client = CommitmentAreaChairFallbackClient()

    snapshot = OpenReviewGateway().fetch_dashboard_snapshot(client, "aclweb.org/ACL/2026/Conference")

    assert (None, "aclweb.org/ACL/2026/Conference") in client.all_group_requests
    assert "aclweb.org/ACL/2026/Conference/Submission42/Area_Chairs" not in client.group_requests
    assert snapshot["submissions"][0]["area_chairs"] == ["~Fallback_AC1"]
    assert snapshot["submissions"][0]["reviewers"] == ["~Reviewer1"]


def test_commitment_bulk_group_resolution_continues_after_missing_alternative() -> None:
    first_group = "aclweb.org/ACL/2026/Conference/Commitment42/Reviewers"
    second_group = "aclweb.org/ACL/2026/Conference/Submission42/Reviewers"

    members = openreview_gateway._resolve_group_members(
        (first_group, second_group),
        {
            second_group: SimpleNamespace(
                id=second_group,
                members=["~ReviewerBulk"],
            )
        },
    )

    assert members == ["~ReviewerBulk"]


def test_commitment_bulk_group_resolution_continues_after_empty_alternative() -> None:
    first_group = "aclweb.org/ACL/2026/Conference/Commitment42/Reviewers"
    second_group = "aclweb.org/ACL/2026/Conference/Submission42/Reviewers"

    members = openreview_gateway._resolve_group_members(
        (first_group, second_group),
        {
            first_group: SimpleNamespace(id=first_group, members=[]),
            second_group: SimpleNamespace(id=second_group, members=["~ReviewerBulk"]),
        },
        continue_on_empty=True,
    )

    assert members == ["~ReviewerBulk"]


def test_gateway_skips_out_of_scope_commitment_entries_before_loading_forum() -> None:
    class CommitmentScopeClient(CommitmentBatchClient):
        def __init__(self) -> None:
            super().__init__()
            self.user = {"profile": {"id": "~Test_SAC1", "fullname": "Test SAC"}}

        def get_group(self, group_id: str):
            if group_id == "aclweb.org/ACL/2026/Conference":
                return SimpleNamespace(content={"submission_name": {"value": "Commitment"}})
            if group_id == "aclweb.org/ACL/2026/Conference/Commitment42/Reviewers":
                return SimpleNamespace(members=["~Reviewer1"])
            raise AssertionError(f"Unexpected group lookup: {group_id}")

        def get_all_groups(self, prefix: str, members: str | None = None):
            assert prefix == "aclweb.org/ACL/2026/Conference"
            if members is None:
                return [
                    SimpleNamespace(
                        id="aclweb.org/ACL/2026/Conference/Commitment42/Reviewers",
                        members=["~Reviewer1"],
                    )
                ]
            assert members == "~Test_SAC1"
            return [
                SimpleNamespace(id="aclweb.org/ACL/2026/Conference/Commitment7/Senior_Area_Chairs"),
            ]

        def get_all_notes(self, invitation: str, details: str | None = None):
            assert invitation == "aclweb.org/ACL/2026/Conference/-/Commitment"
            assert details is None
            return [
                SimpleNamespace(
                    number=7,
                    id="commitment-7",
                    readers=["aclweb.org/ACL/2026/Conference/Commitment7/Senior_Area_Chairs"],
                    content={
                        "paper_link": {"value": "https://openreview.net/forum?id=arr-paper-42"},
                        "area_chair": {"value": "~Area_ChairCommitment"},
                    },
                ),
                SimpleNamespace(
                    number=8,
                    id="commitment-8",
                    readers=["aclweb.org/ACL/2026/Conference/Commitment8/Senior_Area_Chairs"],
                    content={"paper_link": {"value": "https://openreview.net/forum?id=arr-paper-99"}},
                ),
            ]

        def _note_for_batch(self, note_id: str) -> SimpleNamespace:
            assert note_id == "arr-paper-42"
            return SimpleNamespace(
                number=42,
                id="arr-paper-42",
                readers=["everyone"],
                content={"venue": {"value": "ACL ARR 2026 March"}},
                details={"replies": []},
            )

    client = CommitmentScopeClient()

    snapshot = OpenReviewGateway().fetch_dashboard_snapshot(client, "aclweb.org/ACL/2026/Conference")

    assert client.batch_requests == [
        {"ids": ["arr-paper-42"], "limit": 1}
    ]
    assert [submission["id"] for submission in snapshot["submissions"]] == ["arr-paper-42"]
    assert snapshot["submissions"][0]["forum_url"] == "https://openreview.net/forum?id=commitment-7"


def test_gateway_uses_venue_level_area_chair_membership_for_commitment_stage() -> None:
    class CommitmentVenueAreaChairClient(CommitmentBatchClient):
        def __init__(self) -> None:
            super().__init__()
            self.user = {"profile": {"id": "~Test_SAC1", "fullname": "Test SAC"}}

        def get_group(self, group_id: str):
            if group_id == "aclweb.org/ACL/2026/Conference":
                return SimpleNamespace(content={"submission_name": {"value": "Commitment"}})
            if group_id == "aclweb.org/ACL/2026/Conference/Commitment42/Reviewers":
                return SimpleNamespace(members=[])
            if group_id.endswith("/Area_Chairs"):
                raise openreview_gateway.openreview.OpenReviewException(
                    {"name": "NotFoundError", "status": 404, "message": "Group not found"}
                )
            raise AssertionError(f"Unexpected group lookup: {group_id}")

        def get_all_groups(self, prefix: str, members: str | None = None):
            assert prefix == "aclweb.org/ACL/2026/Conference"
            if members is None:
                return [
                    SimpleNamespace(
                        id="aclweb.org/ACL/2026/Conference/Commitment42/Area_Chairs",
                        members=[],
                    ),
                    SimpleNamespace(
                        id="aclweb.org/ACL/2026/Conference/Commitment42/Reviewers",
                        members=[],
                    ),
                ]
            assert members == "~Test_SAC1"
            return [
                SimpleNamespace(id="aclweb.org/ACL/2026/Conference/Area_Chairs"),
            ]

        def get_all_notes(self, invitation: str, details: str | None = None):
            assert invitation == "aclweb.org/ACL/2026/Conference/-/Commitment"
            assert details is None
            return [
                SimpleNamespace(
                    number=7,
                    id="commitment-7",
                    readers=["everyone"],
                    content={"paper_link": {"value": "https://openreview.net/forum?id=arr-paper-42"}},
                ),
            ]

        def _note_for_batch(self, note_id: str) -> SimpleNamespace:
            return SimpleNamespace(
                number=42,
                id="arr-paper-42",
                readers=["everyone"],
                content={"venue": {"value": "ACL ARR 2026 March"}},
                details={"replies": []},
            )

    client = CommitmentVenueAreaChairClient()

    snapshot = OpenReviewGateway().fetch_dashboard_snapshot(client, "aclweb.org/ACL/2026/Conference")

    assert client.batch_requests == [
        {"ids": ["arr-paper-42"], "limit": 1}
    ]
    assert snapshot["my_sac_groups"] == ["aclweb.org/ACL/2026/Conference/Area_Chairs"]
    assert [submission["id"] for submission in snapshot["submissions"]] == ["arr-paper-42"]
    assert snapshot["submissions"][0]["forum_url"] == "https://openreview.net/forum?id=commitment-7"
    assert snapshot["submissions"][0]["readers"] == [
        "aclweb.org/ACL/2026/Conference/Area_Chairs",
        "everyone",
    ]


def test_gateway_skips_commitment_entries_visible_through_authors_group() -> None:
    class CommitmentAuthorClient:
        def __init__(self) -> None:
            self.user = {"profile": {"id": "~Test_SAC1", "fullname": "Test SAC"}}
            self.forum_requests: list[tuple[str, str]] = []

        def get_group(self, group_id: str):
            if group_id == "aclweb.org/ACL/2026/Conference":
                return SimpleNamespace(content={"submission_name": {"value": "Commitment"}})
            raise AssertionError(f"Unexpected group lookup: {group_id}")

        def get_all_groups(self, prefix: str, members: str | None = None):
            assert prefix == "aclweb.org/ACL/2026/Conference"
            assert members == "~Test_SAC1"
            return [
                SimpleNamespace(id="aclweb.org/ACL/2026/Conference/Commitment8/Authors"),
            ]

        def get_all_notes(self, invitation: str, details: str | None = None):
            assert invitation == "aclweb.org/ACL/2026/Conference/-/Commitment"
            assert details is None
            return [
                SimpleNamespace(
                    number=8,
                    id="commitment-8",
                    readers=["aclweb.org/ACL/2026/Conference/Commitment8/Authors"],
                    content={"paper_link": {"value": "https://openreview.net/forum?id=arr-paper-99"}},
                ),
            ]

        def get_note(self, note_id: str, details: str):
            self.forum_requests.append((note_id, details))
            raise AssertionError("Author-visible commitment entries should be skipped before forum load")

    client = CommitmentAuthorClient()

    snapshot = OpenReviewGateway().fetch_dashboard_snapshot(client, "aclweb.org/ACL/2026/Conference")

    assert client.forum_requests == []
    assert snapshot["submissions"] == []


def test_gateway_fails_closed_when_scoped_commitment_entry_has_invalid_link() -> None:
    class MissingLinkClient:
        user = {"profile": {"id": "~Test_SAC1", "fullname": "Test SAC"}}

        def get_group(self, group_id: str):
            return SimpleNamespace(content={"submission_name": {"value": "Commitment"}})

        def get_all_groups(self, prefix: str, members: str | None = None):
            assert members == "~Test_SAC1"
            return [SimpleNamespace(id=f"{prefix}/Area_Chairs")]

        def get_all_notes(self, invitation: str, details: str | None = None):
            assert details is None
            return [
                SimpleNamespace(
                    number=7,
                    id="commitment-7",
                    readers=["aclweb.org/ACL/2026/Conference/Area_Chairs"],
                    content={},
                )
            ]

    with pytest.raises(DashboardFetchError, match="invalid paper links=1"):
        OpenReviewGateway().fetch_dashboard_snapshot(
            MissingLinkClient(),
            "aclweb.org/ACL/2026/Conference",
        )
