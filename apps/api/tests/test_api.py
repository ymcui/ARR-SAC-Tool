from __future__ import annotations

import json
import xml.etree.ElementTree as ET
import zipfile
from io import BytesIO
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import create_app
from app.schemas import (
    DashboardResponse,
    PaperRecord,
    ScoreSummary,
    SummaryInfo,
    VenueInfo,
    ViewerInfo,
)
from app.services.export_xlsx import build_dashboard_export_xlsx
from app.services.openreview_gateway import AuthenticationError
from app.session_store import SessionStore


FIXTURE_PATH = Path(__file__).parent / "fixtures" / "openreview_snapshot.json"


class FakeGateway:
    def __init__(self, snapshot: dict, fail_login: bool = False) -> None:
        self.snapshot = snapshot
        self.fail_login = fail_login
        self.fetch_count = 0

    def authenticate(self, username: str, password: str):
        if self.fail_login:
            raise AuthenticationError("Invalid OpenReview credentials.")
        return object(), ViewerInfo(id="~Test_SAC1", fullname="Test SAC")

    def fetch_dashboard_snapshot(self, client, venue_id: str, progress_callback=None) -> dict:
        self.fetch_count += 1
        if progress_callback:
            progress_callback("submissions", "Fetching venue submissions and replies...", 1, 3)
        return self.snapshot


def load_fixture() -> dict:
    return json.loads(FIXTURE_PATH.read_text())


def _sheet_cell_text(sheet_xml: str, cell_ref: str) -> str:
    namespace = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    root = ET.fromstring(sheet_xml)
    cell = root.find(f".//m:c[@r='{cell_ref}']", namespace)
    if cell is None:
        return ""

    value = cell.find("m:v", namespace)
    if value is not None:
        return value.text or ""

    text = cell.find("m:is/m:t", namespace)
    return "" if text is None or text.text is None else text.text


def _sheet_cell_style(sheet_xml: str, cell_ref: str) -> str:
    namespace = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    root = ET.fromstring(sheet_xml)
    cell = root.find(f".//m:c[@r='{cell_ref}']", namespace)
    return "" if cell is None else cell.attrib.get("s", "")


def test_login_failure_returns_401() -> None:
    app = create_app(gateway=FakeGateway(load_fixture(), fail_login=True), session_store=SessionStore())
    client = TestClient(app)

    response = client.post(
        "/api/session/login",
        json={"username": "wrong@example.com", "password": "bad-password"},
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid OpenReview credentials."


def test_dashboard_cache_and_refresh_flow() -> None:
    gateway = FakeGateway(load_fixture())
    app = create_app(gateway=gateway, session_store=SessionStore(cache_ttl_seconds=999))
    client = TestClient(app)

    login_response = client.post(
        "/api/session/login",
        json={"username": "demo@example.com", "password": "secret"},
    )
    assert login_response.status_code == 200

    first = client.get("/api/dashboard", params={"venueId": "aclweb.org/ACL/ARR/2026/March"})
    second = client.get("/api/dashboard", params={"venueId": "aclweb.org/ACL/ARR/2026/March"})
    refreshed = client.get(
        "/api/dashboard",
        params={"venueId": "aclweb.org/ACL/ARR/2026/March", "refresh": 1},
    )

    assert first.status_code == 200
    assert second.status_code == 200
    assert refreshed.status_code == 200
    assert first.json()["venue"]["stage"] == "ARR Stage"
    assert gateway.fetch_count == 2

    logout_response = client.post("/api/session/logout")
    assert logout_response.status_code == 200

    after_logout = client.get("/api/dashboard", params={"venueId": "aclweb.org/ACL/ARR/2026/March"})
    assert after_logout.status_code == 401


def test_dashboard_progress_endpoint_reports_completion_state() -> None:
    gateway = FakeGateway(load_fixture())
    app = create_app(gateway=gateway, session_store=SessionStore(cache_ttl_seconds=999))
    client = TestClient(app)

    login_response = client.post(
        "/api/session/login",
        json={"username": "demo@example.com", "password": "secret"},
    )
    assert login_response.status_code == 200

    dashboard_response = client.get("/api/dashboard", params={"venueId": "aclweb.org/ACL/ARR/2026/March"})
    assert dashboard_response.status_code == 200

    progress_response = client.get(
        "/api/dashboard/progress",
        params={"venueId": "aclweb.org/ACL/ARR/2026/March"},
    )
    assert progress_response.status_code == 200
    assert progress_response.json()["phase"] == "ready"
    assert progress_response.json()["done"] is True


def test_dashboard_export_endpoint_returns_cached_workspace_xlsx() -> None:
    gateway = FakeGateway(load_fixture())
    app = create_app(gateway=gateway, session_store=SessionStore(cache_ttl_seconds=999))
    client = TestClient(app)

    login_response = client.post(
        "/api/session/login",
        json={"username": "demo@example.com", "password": "secret"},
    )
    assert login_response.status_code == 200

    dashboard_response = client.get("/api/dashboard", params={"venueId": "aclweb.org/ACL/ARR/2026/March"})
    assert dashboard_response.status_code == 200

    export_response = client.get("/api/dashboard/export", params={"venueId": "aclweb.org/ACL/ARR/2026/March"})

    assert export_response.status_code == 200
    assert export_response.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    assert "aclweb.org_ACL_ARR_2026_March_paper_export.xlsx" in export_response.headers["content-disposition"]

    with zipfile.ZipFile(BytesIO(export_response.content)) as workbook:
        sheet_xml = workbook.read("xl/worksheets/sheet1.xml").decode("utf-8")

    assert "Paper ID" in sheet_xml
    assert "paper42" in sheet_xml


def test_commitment_export_matches_sac_ranking_template_shape() -> None:
    dashboard = DashboardResponse(
        viewer=ViewerInfo(id="~Test_SAC1", fullname="Test SAC"),
        venue=VenueInfo(
            venueId="aclweb.org/ACL/2026/Conference",
            stage="Commitment Stage",
            submissionName="Submission",
            lastSyncedAt="2026-05-07T00:00:00+00:00",
        ),
        summary=SummaryInfo(totalPapers=1, readyPapers=0, metaReviewsDone=1, commentsCount=0),
        papers=[
            PaperRecord(
                paperNumber=3232,
                paperId="arr-forum-3232",
                paperTitle="Committed Work",
                paperType="Long",
                areaChair="~Area_Chair1",
                completedReviews=3,
                expectedReviews=3,
                readyForRebuttal=False,
                authorResponseReady=False,
                acChecklistReady=False,
                resubmission=True,
                preprint=False,
                hasConfidential=True,
                issueReport=False,
                reviewerConfidence=ScoreSummary(average=4.0, values=[4.0, 3.0, 5.0]),
                soundnessScore=ScoreSummary(average=3.7, values=[3.0, 4.0, 4.0]),
                excitementScore=ScoreSummary(average=3.3, values=[3.0, 3.0, 4.0]),
                overallAssessment=ScoreSummary(average=3.5, values=[3.0, 3.5, 4.0]),
                metaReviewScore=4.0,
                metaReviewText="Metareview:\nStrong paper with clear contribution.\x0b",
                responseToMetaReview="Thank you for the helpful meta-review.",
                forumUrl="https://openreview.net/forum?id=commitment-3232",
            )
        ],
    )

    with zipfile.ZipFile(BytesIO(build_dashboard_export_xlsx(dashboard))) as workbook:
        sheet_xml = workbook.read("xl/worksheets/sheet1.xml").decode("utf-8")
        rels_xml = workbook.read("xl/worksheets/_rels/sheet1.xml.rels").decode("utf-8")
        styles_xml = workbook.read("xl/styles.xml").decode("utf-8")

    assert '<dimension ref="A1:Y2"/>' in sheet_xml
    assert "Submission Number" in sheet_xml
    assert "SAC Ranking" in sheet_xml
    assert "Response to Meta Review" in sheet_xml
    assert "SAC Meta Review" in sheet_xml
    assert "\x0b" not in sheet_xml
    assert sheet_xml.index("<autoFilter") < sheet_xml.index("<hyperlinks>")
    assert 'min="5" max="5"' in sheet_xml and 'hidden="1"' in sheet_xml
    assert _sheet_cell_text(sheet_xml, "A2") == "3232"
    assert _sheet_cell_text(sheet_xml, "B2") == "link"
    assert _sheet_cell_style(sheet_xml, "B2") == "3"
    assert _sheet_cell_style(sheet_xml, "M2") == "4"
    assert _sheet_cell_style(sheet_xml, "N2") == "4"
    assert _sheet_cell_style(sheet_xml, "Y2") == "4"
    assert '<alignment horizontal="center" vertical="center" wrapText="1"/>' in styles_xml
    assert '<alignment vertical="center" wrapText="1"/>' in styles_xml
    assert "https://openreview.net/forum?id=commitment-3232" in rels_xml
    assert [_sheet_cell_text(sheet_xml, f"{column}2") for column in "STUVWXY"] == [""] * 7
