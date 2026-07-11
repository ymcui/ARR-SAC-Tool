from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.services import openreview_gateway
from app.services.openreview_gateway import (
    AuthenticationError,
    AuthenticationMfaRequired,
    AuthenticationServiceError,
    DashboardAuthenticationError,
    DashboardFetchError,
    OpenReviewGateway,
)


class LoginResponse:
    def __init__(self, status_code: int, payload: dict) -> None:
        self.status_code = status_code
        self.ok = 200 <= status_code < 300
        self.payload = payload

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


def test_authenticate_maps_upstream_server_failure(monkeypatch) -> None:
    client = login_client(LoginResponse(503, {}))
    monkeypatch.setattr(openreview_gateway.openreview.api, "OpenReviewClient", lambda **kwargs: client)

    with pytest.raises(AuthenticationServiceError, match="503"):
        OpenReviewGateway().authenticate("sac@example.com", "password")


class FakeClient:
    def __init__(self) -> None:
        self.user = {"profile": {"id": "~Test_SAC1", "fullname": "Test SAC"}}
        self.note_requests: list[tuple[str, str | None, int | None]] = []
        self.group_requests: list[str] = []
        self.all_group_requests: list[tuple[str | None, str]] = []
        self.grouped_edge_requests: list[tuple[str, str, str]] = []
        self.profile_requests: list[str] = []

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

    assert sorted(number for _, _, number in client.note_requests) == [42, 77, 99]
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


def test_gateway_keeps_public_readable_submission_when_viewer_has_sac_group() -> None:
    class PublicReaderClient(FakeClient):
        def get_all_groups(self, prefix: str, members: str | None = None):
            groups = super().get_all_groups(prefix=prefix, members=members)
            if members is None:
                return groups
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
            if number == 101:
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


def test_gateway_falls_back_to_single_group_lookup_when_bulk_group_is_missing() -> None:
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

    snapshot = OpenReviewGateway().fetch_dashboard_snapshot(client, "aclweb.org/ACL/ARR/2026/March")

    assert snapshot["submissions"][1]["reviewers"] == ["~Reviewer1", "~Reviewer2", "~Reviewer3"]
    assert client.group_requests.count("aclweb.org/ACL/ARR/2026/March/Submission77/Reviewers") == 1
    assert "aclweb.org/ACL/ARR/2026/March/Submission77/Area_Chairs" not in client.group_requests


def test_gateway_falls_back_when_bulk_anonymous_group_mapping_is_missing() -> None:
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

    snapshot = OpenReviewGateway().fetch_dashboard_snapshot(client, "aclweb.org/ACL/ARR/2026/March")

    assert snapshot["submissions"][1]["area_chairs"] == ["~Area_Chair"]
    assert client.group_requests.count("aclweb.org/ACL/ARR/2026/March/Submission77/Area_Chairs") == 1


def test_gateway_fails_closed_when_assignment_group_cannot_be_loaded() -> None:
    missing_group_id = "aclweb.org/ACL/ARR/2026/March/Submission77/Reviewers"

    class FailingGroupClient(FakeClient):
        def get_all_groups(self, prefix: str, members: str | None = None):
            groups = super().get_all_groups(prefix=prefix, members=members)
            if members is not None:
                return groups
            return [group for group in groups if group.id != missing_group_id]

        def get_group(self, group_id: str):
            if group_id == missing_group_id:
                raise RuntimeError("OpenReview unavailable")
            return super().get_group(group_id)

    with pytest.raises(DashboardFetchError, match="Could not resolve assignment group"):
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
            if number != 42:
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
            self.note_requests: list[str] = []
            self.forum_requests: list[tuple[str, str]] = []
            self.group_requests: list[str] = []
            self.all_group_requests: list[tuple[str | None, str]] = []

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

        def get_all_notes(self, invitation: str):
            assert invitation == "aclweb.org/ACL/2026/Conference/-/Commitment"
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
    assert client.forum_requests == [("arr-paper-42", "replies")]
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


def test_gateway_continues_commitment_area_chair_lookup_after_empty_bulk_group() -> None:
    class CommitmentAreaChairFallbackClient:
        def __init__(self) -> None:
            self.user = {"profile": {"id": "~Test_SAC1", "fullname": "Test SAC"}}
            self.all_group_requests: list[tuple[str | None, str]] = []
            self.forum_requests: list[tuple[str, str]] = []
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

        def get_all_notes(self, invitation: str):
            assert invitation == "aclweb.org/ACL/2026/Conference/-/Commitment"
            return [
                SimpleNamespace(
                    number=7,
                    id="commitment-7",
                    readers=["everyone"],
                    content={"paper_link": {"value": "https://openreview.net/forum?id=arr-paper-42"}},
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
                content={"venue": {"value": "ACL ARR 2026 March"}},
                details={"replies": []},
            )

    client = CommitmentAreaChairFallbackClient()

    snapshot = OpenReviewGateway().fetch_dashboard_snapshot(client, "aclweb.org/ACL/2026/Conference")

    assert (None, "aclweb.org/ACL/2026/Conference") in client.all_group_requests
    assert "aclweb.org/ACL/2026/Conference/Submission42/Area_Chairs" not in client.group_requests
    assert snapshot["submissions"][0]["area_chairs"] == ["~Fallback_AC1"]
    assert snapshot["submissions"][0]["reviewers"] == ["~Reviewer1"]


def test_commitment_group_fallback_continues_after_missing_alternative() -> None:
    first_group = "aclweb.org/ACL/2026/Conference/Commitment42/Reviewers"
    second_group = "aclweb.org/ACL/2026/Conference/Submission42/Reviewers"

    class MissingAlternativeClient:
        def __init__(self) -> None:
            self.requests: list[str] = []

        def get_group(self, group_id: str):
            self.requests.append(group_id)
            if group_id == first_group:
                raise openreview_gateway.openreview.OpenReviewException(
                    {"name": "NotFoundError", "status": 404, "message": "Group not found"}
                )
            return SimpleNamespace(members=["~ReviewerFallback"])

    client = MissingAlternativeClient()

    members = openreview_gateway._resolve_group_members(client, (first_group, second_group))

    assert members == ["~ReviewerFallback"]
    assert client.requests == [first_group, second_group]


def test_commitment_group_fallback_fails_closed_on_upstream_outage() -> None:
    first_group = "aclweb.org/ACL/2026/Conference/Commitment42/Reviewers"
    second_group = "aclweb.org/ACL/2026/Conference/Submission42/Reviewers"

    class UnavailableGroupClient:
        def __init__(self) -> None:
            self.requests: list[str] = []

        def get_group(self, group_id: str):
            self.requests.append(group_id)
            raise openreview_gateway.openreview.OpenReviewException(
                {
                    "name": "InternalServerError",
                    "status": 503,
                    "message": "Group not found while the service is unavailable",
                }
            )

    client = UnavailableGroupClient()

    with pytest.raises(DashboardFetchError, match="Could not resolve assignment group"):
        openreview_gateway._resolve_group_members(client, (first_group, second_group))

    assert client.requests == [first_group]


def test_gateway_skips_out_of_scope_commitment_entries_before_loading_forum() -> None:
    class CommitmentScopeClient:
        def __init__(self) -> None:
            self.user = {"profile": {"id": "~Test_SAC1", "fullname": "Test SAC"}}
            self.forum_requests: list[tuple[str, str]] = []

        def get_group(self, group_id: str):
            if group_id == "aclweb.org/ACL/2026/Conference":
                return SimpleNamespace(content={"submission_name": {"value": "Commitment"}})
            if group_id == "aclweb.org/ACL/2026/Conference/Commitment42/Reviewers":
                return SimpleNamespace(members=["~Reviewer1"])
            raise AssertionError(f"Unexpected group lookup: {group_id}")

        def get_all_groups(self, prefix: str, members: str | None = None):
            assert prefix == "aclweb.org/ACL/2026/Conference"
            assert members == "~Test_SAC1"
            return [
                SimpleNamespace(id="aclweb.org/ACL/2026/Conference/Commitment7/Senior_Area_Chairs"),
            ]

        def get_all_notes(self, invitation: str):
            assert invitation == "aclweb.org/ACL/2026/Conference/-/Commitment"
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

        def get_note(self, note_id: str, details: str):
            self.forum_requests.append((note_id, details))
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

    assert client.forum_requests == [("arr-paper-42", "replies")]
    assert [submission["id"] for submission in snapshot["submissions"]] == ["arr-paper-42"]
    assert snapshot["submissions"][0]["forum_url"] == "https://openreview.net/forum?id=commitment-7"


def test_gateway_uses_venue_level_area_chair_membership_for_commitment_stage() -> None:
    class CommitmentVenueAreaChairClient:
        def __init__(self) -> None:
            self.user = {"profile": {"id": "~Test_SAC1", "fullname": "Test SAC"}}
            self.forum_requests: list[tuple[str, str]] = []

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
            assert members == "~Test_SAC1"
            return [
                SimpleNamespace(id="aclweb.org/ACL/2026/Conference/Area_Chairs"),
            ]

        def get_all_notes(self, invitation: str):
            assert invitation == "aclweb.org/ACL/2026/Conference/-/Commitment"
            return [
                SimpleNamespace(
                    number=7,
                    id="commitment-7",
                    readers=["everyone"],
                    content={"paper_link": {"value": "https://openreview.net/forum?id=arr-paper-42"}},
                ),
            ]

        def get_note(self, note_id: str, details: str):
            self.forum_requests.append((note_id, details))
            return SimpleNamespace(
                number=42,
                id="arr-paper-42",
                readers=["everyone"],
                content={"venue": {"value": "ACL ARR 2026 March"}},
                details={"replies": []},
            )

    client = CommitmentVenueAreaChairClient()

    snapshot = OpenReviewGateway().fetch_dashboard_snapshot(client, "aclweb.org/ACL/2026/Conference")

    assert client.forum_requests == [("arr-paper-42", "replies")]
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

        def get_all_notes(self, invitation: str):
            assert invitation == "aclweb.org/ACL/2026/Conference/-/Commitment"
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

        def get_all_notes(self, invitation: str):
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
