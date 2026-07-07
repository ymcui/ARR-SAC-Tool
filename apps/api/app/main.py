from __future__ import annotations

import faulthandler
import logging
import platform
import time
from typing import Optional

from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from app.schemas import DashboardLoadProgress, DashboardResponse, LoginRequest, ViewerInfo
from app.services.dashboard_logic import build_dashboard_response
from app.services.export_xlsx import XLSX_MEDIA_TYPE, build_dashboard_export_xlsx, export_filename
from app.services.openreview_gateway import (
    AuthenticationError,
    DashboardFetchError,
    OpenReviewGateway,
)
from app.session_store import SessionStore

SESSION_COOKIE_NAME = "arr_sac_session"
logger = logging.getLogger(__name__)
faulthandler.enable()


def create_app(
    gateway: Optional[OpenReviewGateway] = None,
    session_store: Optional[SessionStore] = None,
) -> FastAPI:
    app = FastAPI(title="ARR SAC Dashboard API", version="0.1.0")
    app.state.gateway = gateway or OpenReviewGateway()
    app.state.sessions = session_store or SessionStore()

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://127.0.0.1:8000",
            "http://localhost:8000",
        ],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/api/health")
    def health() -> dict:
        return {
            "status": "ok",
            "backend": "fastapi",
            "pythonVersion": platform.python_version(),
            "activeSessions": app.state.sessions.count(),
        }

    @app.post("/api/session/login", response_model=ViewerInfo)
    def login(payload: LoginRequest, request: Request, response: Response) -> ViewerInfo:
        existing_session = request.cookies.get(SESSION_COOKIE_NAME)
        if existing_session:
            app.state.sessions.delete_session(existing_session)

        try:
            client, viewer = app.state.gateway.authenticate(payload.username, payload.password)
        except AuthenticationError as exc:
            raise HTTPException(status_code=401, detail=str(exc)) from exc

        session_id = app.state.sessions.create_session(client=client, viewer=viewer)
        response.set_cookie(
            key=SESSION_COOKIE_NAME,
            value=session_id,
            httponly=True,
            samesite="lax",
            secure=False,
            path="/",
        )
        return viewer

    @app.post("/api/session/logout")
    def logout(request: Request, response: Response) -> dict:
        session_id = request.cookies.get(SESSION_COOKIE_NAME)
        if session_id:
            app.state.sessions.delete_session(session_id)
        response.delete_cookie(key=SESSION_COOKIE_NAME, path="/")
        return {"status": "ok"}

    @app.get("/api/dashboard", response_model=DashboardResponse)
    def dashboard(
        request: Request,
        venueId: str = Query(..., min_length=3),
        refresh: bool = Query(False),
        loadId: Optional[str] = Query(None),
    ) -> DashboardResponse:
        request_started_at = time.perf_counter()
        session_id = request.cookies.get(SESSION_COOKIE_NAME)
        if not session_id:
            raise HTTPException(status_code=401, detail="Login required.")

        session = app.state.sessions.get_session(session_id)
        if session is None:
            raise HTTPException(status_code=401, detail="Session expired.")

        if not refresh:
            cached = app.state.sessions.get_cached_dashboard(session_id, venueId)
            if cached is not None:
                logger.warning(
                    "Dashboard request served from cache in %.2fs for venue %s: papers=%s withdrawn=%s comments=%s",
                    time.perf_counter() - request_started_at,
                    venueId,
                    len(cached.papers),
                    len(cached.withdrawnPapers),
                    cached.summary.commentsCount,
                )
                app.state.sessions.set_progress(
                    session_id,
                    venueId,
                    DashboardLoadProgress(
                        venueId=venueId,
                        loadId=loadId,
                        phase="ready",
                        message="Loaded cached workspace.",
                        current=len(cached.papers),
                        total=len(cached.papers),
                        done=True,
                    ),
                )
                return cached

        def set_progress(
            phase: str,
            message: str,
            current: int = 0,
            total: int = 0,
            done: bool = False,
            error: str | None = None,
        ) -> None:
            app.state.sessions.set_progress(
                session_id,
                venueId,
                DashboardLoadProgress(
                    venueId=venueId,
                    loadId=loadId,
                    phase=phase,
                    message=message,
                    current=current,
                    total=total,
                    done=done,
                    error=error,
                ),
            )

        set_progress("venue", "Starting venue load...", 0, 0)

        try:
            snapshot = app.state.gateway.fetch_dashboard_snapshot(
                session.client,
                venueId,
                progress_callback=set_progress,
            )
        except DashboardFetchError as exc:
            set_progress("error", str(exc), 0, 0, done=True, error=str(exc))
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        try:
            logger.warning("Building dashboard response for venue %s", venueId)
            payload = build_dashboard_response(snapshot, venueId, progress_callback=set_progress)
            logger.warning("Built dashboard response for venue %s", venueId)
        except Exception as exc:
            logger.exception("Unhandled dashboard build error for venue %s", venueId)
            detail = "The dashboard could not be built from the OpenReview response."
            set_progress("error", detail, 0, 0, done=True, error=detail)
            raise HTTPException(
                status_code=500,
                detail=detail,
            ) from exc

        app.state.sessions.cache_dashboard(session_id, venueId, payload)
        set_progress(
            "ready",
            f"Loaded {len(payload.papers)} papers for this SAC batch.",
            len(payload.papers),
            len(payload.papers),
            done=True,
        )
        logger.warning(
            (
                "Dashboard request completed in %.2fs for venue %s: "
                "papers=%s withdrawn=%s area_chairs=%s comments=%s refresh=%s"
            ),
            time.perf_counter() - request_started_at,
            venueId,
            len(payload.papers),
            len(payload.withdrawnPapers),
            len(payload.areaChairs),
            payload.summary.commentsCount,
            refresh,
        )
        return payload

    @app.get("/api/dashboard/progress", response_model=DashboardLoadProgress)
    def dashboard_progress(
        request: Request,
        venueId: str = Query(..., min_length=3),
    ) -> DashboardLoadProgress:
        session_id = request.cookies.get(SESSION_COOKIE_NAME)
        if not session_id:
            raise HTTPException(status_code=401, detail="Login required.")

        session = app.state.sessions.get_session(session_id)
        if session is None:
            raise HTTPException(status_code=401, detail="Session expired.")

        progress = app.state.sessions.get_progress(session_id, venueId)
        if progress is None:
            return DashboardLoadProgress(
                venueId=venueId,
                phase="idle",
                message="Waiting to load the selected venue.",
                current=0,
                total=0,
                done=False,
            )

        return progress

    @app.get("/api/dashboard/export")
    def dashboard_export(
        request: Request,
        venueId: str = Query(..., min_length=3),
    ) -> Response:
        session_id = request.cookies.get(SESSION_COOKIE_NAME)
        if not session_id:
            raise HTTPException(status_code=401, detail="Login required.")

        session = app.state.sessions.get_session(session_id)
        if session is None:
            raise HTTPException(status_code=401, detail="Session expired.")

        cached = app.state.sessions.get_cached_dashboard(session_id, venueId)
        if cached is None:
            raise HTTPException(status_code=404, detail="Load the selected venue before exporting.")

        content = build_dashboard_export_xlsx(cached)
        filename = export_filename(venueId)
        return Response(
            content=content,
            media_type=XLSX_MEDIA_TYPE,
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    return app


app = create_app()
