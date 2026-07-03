from __future__ import annotations

import json
from pathlib import Path

from app.services.dashboard_logic import build_dashboard_response


FIXTURE_PATH = Path(__file__).parent / "fixtures" / "openreview_snapshot.json"


def load_fixture() -> dict:
    return json.loads(FIXTURE_PATH.read_text())


def test_build_dashboard_response_matches_notebook_rules() -> None:
    snapshot = load_fixture()
    snapshot["area_chair_contacts"] = {
        "~Area_Chair1": {"name": "Area Chair One", "email": "chair1@example.com"},
        "~Area_Chair2": {"name": "Area Chair Two", "email": "chair2@example.com"},
    }
    response = build_dashboard_response(snapshot, "aclweb.org/ACL/ARR/2026/March")

    assert response.venue.stage == "ARR Stage"
    assert response.summary.totalPapers == 2
    assert response.summary.readyPapers == 1
    assert response.summary.metaReviewsDone == 2
    assert response.summary.commentsCount == 5
    assert response.summary.alertsCount == 2
    assert len(response.withdrawnPapers) == 1
    assert response.withdrawnPapers[0].paperNumber == 44
    assert response.withdrawnPapers[0].paperTitle == "Withdrawn Work on Robust Review Signals"
    assert response.withdrawnPapers[0].areaChair == "~Area_Chair3"

    first_paper = response.papers[0]
    assert first_paper.paperNumber == 42
    assert first_paper.paperTitle == "A Careful Study of Reviewer Discussion Dynamics"
    assert first_paper.readyForRebuttal is True
    assert first_paper.authorResponseReady is True
    assert first_paper.acChecklistReady is True
    assert first_paper.metaReviewScore == 4.0
    assert first_paper.overallAssessment.average == 4.0
    assert first_paper.reviewerConfidence.values == [4.0, 3.0, 4.0]
    assert first_paper.hasConfidential is True
    assert first_paper.issueReport is True
    assert response.analytics.overallAssessmentHistogram[-1].label == "5.0"
    assert "5.0-5.5" not in [point.label for point in response.analytics.overallAssessmentHistogram]
    assert [point.score for point in response.analytics.metaReviewDistribution] == [
        1.0,
        1.5,
        2.0,
        2.5,
        3.0,
        3.5,
        4.0,
        4.5,
        5.0,
    ]
    assert [point.count for point in response.analytics.metaReviewDistribution] == [0, 0, 0, 1, 0, 0, 1, 0, 0]

    assert [group.paperNumber for group in response.comments] == [42]
    assert response.comments[0].paperTitle == "A Careful Study of Reviewer Discussion Dynamics"
    issue_comment = next(item for item in response.comments[0].items if item.noteId == "comment-root")
    assert issue_comment.children[0].noteId == "comment-reply"
    assert all(item.noteId != "delay-alert-reply" for item in response.comments[0].items)

    assert [group.paperNumber for group in response.alerts] == [42]
    assert response.alerts[0].paperTitle == "A Careful Study of Reviewer Discussion Dynamics"
    assert response.alerts[0].items[0].noteId == "delay-alert"
    assert response.alerts[0].items[0].type == "Delay Notification"
    assert response.alerts[0].items[0].signerLabel == "Reviewer REii"
    assert "Notification" in response.alerts[0].items[0].content
    assert response.alerts[0].items[0].children[0].noteId == "delay-alert-reply"
    assert response.alerts[0].items[0].children[0].type == "Official Comment"

    assert [record.areaChair for record in response.areaChairs] == ["~Area_Chair1", "~Area_Chair2"]
    assert response.areaChairs[0].areaChairName == "Area Chair One"
    assert response.areaChairs[0].areaChairEmail == "chair1@example.com"
    assert response.areaChairs[0].allReviewsReady is True
    assert response.areaChairs[1].allMetaReviewsReady is True


def test_missing_reviewer_group_defaults_to_zero_expected_reviews() -> None:
    snapshot = load_fixture()
    snapshot["submissions"][1]["reviewers"] = None

    response = build_dashboard_response(snapshot, "aclweb.org/ACL/ARR/2026/March")

    second_paper = next(paper for paper in response.papers if paper.paperNumber == 43)
    assert second_paper.expectedReviews == 0


def test_non_arr_venue_is_marked_as_commitment_stage() -> None:
    snapshot = load_fixture()

    response = build_dashboard_response(snapshot, "aclweb.org/ACL/2026/Conference")

    assert response.venue.stage == "Commitment Stage"


def test_commitment_stage_venue_level_area_chair_reader_is_in_scope() -> None:
    snapshot = {
        "viewer": {"id": "~Test_SAC1", "fullname": "Test SAC"},
        "submission_name": "Commitment",
        "my_sac_groups": ["aclweb.org/ACL/2026/Conference/Area_Chairs"],
        "submissions": [
            {
                "number": 42,
                "id": "arr-paper-42",
                "forum_url": "https://openreview.net/forum?id=commitment-42",
                "readers": ["everyone", "aclweb.org/ACL/2026/Conference/Area_Chairs"],
                "content": {
                    "venue": {"value": "ACL ARR 2026 March"},
                    "title": {"value": "Committed Work on Review Monitoring"},
                    "Previous URL": {"value": "https://openreview.net/forum?id=previous-arr-paper"},
                    "preprint": {"value": "Yes"},
                },
                "replies": [],
                "area_chairs": ["~Area_Chair1"],
                "reviewers": [],
            }
        ],
    }

    response = build_dashboard_response(snapshot, "aclweb.org/ACL/2026/Conference")

    assert response.summary.totalPapers == 1
    assert response.papers[0].paperId == "arr-paper-42"
    assert response.papers[0].forumUrl == "https://openreview.net/forum?id=commitment-42"
    assert response.papers[0].resubmission is True
    assert response.papers[0].preprint is True


def test_assignment_group_scope_keeps_public_readable_arr_submission() -> None:
    snapshot = {
        "viewer": {"id": "~Test_SAC1", "fullname": "Test SAC"},
        "submission_name": "Submission",
        "my_sac_groups": ["aclweb.org/ACL/ARR/2026/March/Submission493/Senior_Area_Chairs"],
        "submissions": [
            {
                "number": 493,
                "id": "paper-493",
                "prefix": "aclweb.org/ACL/ARR/2026/March/Submission493",
                "sac_group": "aclweb.org/ACL/ARR/2026/March/Submission493/Senior_Area_Chairs",
                "readers": ["everyone"],
                "content": {"venue": {"value": "ARR"}},
                "replies": [],
                "area_chairs": ["~Area_Chair1"],
                "reviewers": [],
            }
        ],
    }

    response = build_dashboard_response(snapshot, "aclweb.org/ACL/ARR/2026/March")

    assert response.summary.totalPapers == 1
    assert response.papers[0].paperNumber == 493


def test_resubmission_requires_previous_url_field() -> None:
    snapshot = {
        "viewer": {"id": "~Test_SAC1", "fullname": "Test SAC"},
        "submission_name": "Commitment",
        "my_sac_groups": ["aclweb.org/ACL/2026/Conference/Area_Chairs"],
        "submissions": [
            {
                "number": 42,
                "id": "arr-paper-42",
                "readers": ["aclweb.org/ACL/2026/Conference/Area_Chairs"],
                "content": {
                    "venue": {"value": "ACL ARR 2026 March"},
                    "resubmission": {"value": "Yes"},
                },
                "replies": [],
                "area_chairs": ["~Area_Chair1"],
                "reviewers": [],
            }
        ],
    }

    response = build_dashboard_response(snapshot, "aclweb.org/ACL/2026/Conference")

    assert response.papers[0].resubmission is False


def test_meta_review_fallback_fields_are_supported() -> None:
    snapshot = {
        "viewer": {"id": "~Test_SAC1", "fullname": "Test SAC"},
        "submission_name": "Submission",
        "my_sac_groups": ["venue/Submission1/Senior_Area_Chairs"],
        "submissions": [
            {
                "number": 1,
                "id": "paper-1",
                "readers": ["venue/Submission1/Senior_Area_Chairs"],
                "content": {"venue": {"value": "ARR"}},
                "replies": [
                    {
                        "invitations": ["venue/Submission1/-/Meta_Review"],
                        "content": {"score": {"value": "3.5 Strong accept"}},
                        "signatures": ["venue/Submission1/Area_Chair_1"],
                    }
                ],
                "area_chairs": ["~Area_Chair1"],
                "reviewers": [],
            }
        ],
    }

    response = build_dashboard_response(snapshot, "venue")
    assert response.papers[0].metaReviewScore == 3.5


def test_empty_comments_produce_empty_comment_groups() -> None:
    snapshot = load_fixture()
    for submission in snapshot["submissions"]:
        submission["replies"] = [
            reply
            for reply in submission["replies"]
            if "Official_Review" in "".join(reply.get("invitations", []))
        ]

    response = build_dashboard_response(snapshot, "aclweb.org/ACL/ARR/2026/March")

    assert response.comments == []
    assert response.summary.commentsCount == 0


def test_standalone_official_comments_do_not_enter_comments_tab() -> None:
    snapshot = {
        "viewer": {"id": "~Test_SAC1", "fullname": "Test SAC"},
        "submission_name": "Submission",
        "my_sac_groups": ["aclweb.org/ACL/ARR/2026/March/Submission1/Senior_Area_Chairs"],
        "submissions": [
            {
                "number": 1,
                "id": "paper-1",
                "readers": ["aclweb.org/ACL/ARR/2026/March/Submission1/Senior_Area_Chairs"],
                "content": {"title": {"value": "Official Comment Scope"}, "venue": {"value": "ARR"}},
                "replies": [
                    {
                        "id": "standalone-official-comment",
                        "forum": "paper-1",
                        "tcdate": 1783072800000,
                        "invitations": [
                            "aclweb.org/ACL/ARR/2026/March/Submission1/-/Official_Comment"
                        ],
                        "signatures": [
                            "aclweb.org/ACL/ARR/2026/March/Submission1/Senior_Area_Chairs"
                        ],
                        "content": {"comment": {"value": "SAC standalone official comment."}},
                    }
                ],
                "area_chairs": ["~Area_Chair1"],
                "reviewers": [],
            }
        ],
    }

    response = build_dashboard_response(snapshot, "aclweb.org/ACL/ARR/2026/March")

    assert response.comments == []
    assert response.summary.commentsCount == 0


def test_alert_matching_is_exact_and_arr_only() -> None:
    snapshot = {
        "viewer": {"id": "~Test_SAC1", "fullname": "Test SAC"},
        "submission_name": "Submission",
        "my_sac_groups": ["aclweb.org/ACL/ARR/2026/March/Submission1/Senior_Area_Chairs"],
        "submissions": [
            {
                "number": 1,
                "id": "paper-1",
                "readers": ["aclweb.org/ACL/ARR/2026/March/Submission1/Senior_Area_Chairs"],
                "content": {"title": {"value": "Alert Exactness"}, "venue": {"value": "ARR"}},
                "replies": [
                    {
                        "id": "emergency-alert",
                        "forum": "paper-1",
                        "tcdate": 1783072800000,
                        "invitations": [
                            "aclweb.org/ACL/ARR/2026/March/Submission1/-/Emergency_Declaration"
                        ],
                        "signatures": [
                            "aclweb.org/ACL/ARR/2026/March/Submission1/Reviewer_F6TN"
                        ],
                        "content": {
                            "Declaration": {"value": "Medical"},
                            "Explanation": {"value": "I need an emergency reviewer replacement."},
                        },
                    },
                    {
                        "id": "urgent-near-miss",
                        "forum": "paper-1",
                        "tcdate": 1783076400000,
                        "invitations": [
                            "aclweb.org/ACL/ARR/2026/March/Submission1/-/Emergency_Declaration_Update"
                        ],
                        "signatures": [
                            "aclweb.org/ACL/ARR/2026/March/Submission1/Reviewer_F6TN"
                        ],
                        "content": {"Explanation": {"value": "This should not be treated as an alert."}},
                    },
                ],
                "area_chairs": ["~Area_Chair1"],
                "reviewers": [],
            }
        ],
    }

    arr_response = build_dashboard_response(snapshot, "aclweb.org/ACL/ARR/2026/March")
    commitment_response = build_dashboard_response(snapshot, "aclweb.org/ACL/2026/Conference")

    assert arr_response.summary.alertsCount == 1
    assert arr_response.alerts[0].items[0].noteId == "emergency-alert"
    assert arr_response.alerts[0].items[0].type == "Emergency Declaration"
    assert "Declaration" in arr_response.alerts[0].items[0].content
    assert "Explanation" in arr_response.alerts[0].items[0].content
    assert commitment_response.summary.alertsCount == 0
    assert commitment_response.alerts == []
