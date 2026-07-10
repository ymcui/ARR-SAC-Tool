from __future__ import annotations

import asyncio
import faulthandler
import logging
import os
import platform
import time
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from app.schemas import DashboardLoadProgress, DashboardResponse, LoginRequest, ViewerInfo
from app.services.dashboard_logic import build_dashboard_response
from app.services.export_xlsx import XLSX_MEDIA_TYPE, build_dashboard_export_xlsx, export_filename
from app.services.openreview_gateway import (
    AuthenticationError,
    AuthenticationMfaRequired,
    AuthenticationServiceError,
    DashboardFetchError,
    OpenReviewGateway,
)
from app.session_store import SessionStore

SESSION_COOKIE_NAME = "arr_sac_session"
DASHBOARD_LOAD_WAIT_TIMEOUT_SECONDS = 5 * 60
SESSION_PRUNE_INTERVAL_SECONDS = 60
logger = logging.getLogger(__name__)
faulthandler.enable()


def secure_session_cookie(request: Request) -> bool:
    configured = os.getenv("ARR_SAC_COOKIE_SECURE", "").strip().lower()
    if configured in {"1", "true", "yes"}:
        return True
    if configured in {"0", "false", "no"}:
        return False

    forwarded_proto = request.headers.get("x-forwarded-proto", "").split(",", 1)[0].strip().lower()
    return request.url.scheme == "https" or forwarded_proto == "https"


def configured_cors_origins() -> list[str]:
    web_host = os.getenv("ARR_SAC_WEB_HOST", "127.0.0.1").strip() or "127.0.0.1"
    web_port = os.getenv("ARR_SAC_WEB_PORT", "8000").strip() or "8000"
    origins = {
        f"http://127.0.0.1:{web_port}",
        f"http://localhost:{web_port}",
    }

    if web_host not in {"0.0.0.0", "127.0.0.1", "localhost"}:
        origins.add(f"http://{web_host}:{web_port}")

    for origin in os.getenv("ARR_SAC_CORS_ORIGINS", "").split(","):
        normalized_origin = origin.strip().rstrip("/")
        if normalized_origin:
            origins.add(normalized_origin)

    return sorted(origins)


def create_app(
    gateway: Optional[OpenReviewGateway] = None,
    session_store: Optional[SessionStore] = None,
) -> FastAPI:
    sessions = session_store or SessionStore()

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        stop_pruning = asyncio.Event()

        async def prune_sessions() -> None:
            while not stop_pruning.is_set():
                try:
                    await asyncio.wait_for(stop_pruning.wait(), timeout=SESSION_PRUNE_INTERVAL_SECONDS)
                except asyncio.TimeoutError:
                    sessions.prune()

        prune_task = asyncio.create_task(prune_sessions())
        try:
            yield
        finally:
            stop_pruning.set()
            await prune_task
            sessions.close_all()

    app = FastAPI(title="ARR SAC Dashboard API", version="0.1.0", lifespan=lifespan)
    app.state.gateway = gateway or OpenReviewGateway()
    app.state.sessions = sessions

    app.add_middleware(
        CORSMiddleware,
        allow_origins=configured_cors_origins(),
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

        try:
            client, viewer = app.state.gateway.authenticate(payload.username, payload.password)
        except AuthenticationError as exc:
            raise HTTPException(status_code=401, detail=str(exc)) from exc
        except AuthenticationMfaRequired as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except AuthenticationServiceError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

        if existing_session:
            app.state.sessions.delete_session(existing_session)
        session_id = app.state.sessions.create_session(client=client, viewer=viewer)
        response.set_cookie(
            key=SESSION_COOKIE_NAME,
            value=session_id,
            httponly=True,
            samesite="lax",
            secure=secure_session_cookie(request),
            path="/",
        )
        return viewer

    @app.post("/api/session/logout")
    def logout(request: Request, response: Response) -> dict:
        session_id = request.cookies.get(SESSION_COOKIE_NAME)
        if session_id:
            app.state.sessions.delete_session(session_id)
        response.delete_cookie(
            key=SESSION_COOKIE_NAME,
            path="/",
            httponly=True,
            samesite="lax",
            secure=secure_session_cookie(request),
        )
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
                set_progress(
                    "ready",
                    "Loaded cached workspace.",
                    len(cached.papers),
                    len(cached.papers),
                    done=True,
                )
                return cached

        owns_load, dashboard_load = app.state.sessions.begin_dashboard_load(session_id, venueId)
        if not owns_load:
            if dashboard_load is None:
                raise HTTPException(status_code=401, detail="Session expired.")

            logger.warning(
                "Dashboard request waiting for in-flight load for venue %s after %.2fs",
                venueId,
                time.time() - dashboard_load.started_at,
            )
            if not dashboard_load.event.wait(timeout=DASHBOARD_LOAD_WAIT_TIMEOUT_SECONDS):
                raise HTTPException(
                    status_code=504,
                    detail="The dashboard load is still running. Try again in a moment.",
                )

            cached = app.state.sessions.get_cached_dashboard(session_id, venueId)
            if cached is not None:
                set_progress(
                    "ready",
                    "Loaded workspace from a refresh that was already running.",
                    len(cached.papers),
                    len(cached.papers),
                    done=True,
                )
                logger.warning(
                    "Dashboard request reused in-flight load in %.2fs for venue %s: papers=%s withdrawn=%s comments=%s",
                    time.perf_counter() - request_started_at,
                    venueId,
                    len(cached.papers),
                    len(cached.withdrawnPapers),
                    cached.summary.commentsCount,
                )
                return cached

            message = dashboard_load.error or "The dashboard refresh did not complete."
            set_progress("error", message, 0, 0, done=True, error=message)
            raise HTTPException(status_code=dashboard_load.status_code, detail=message)

        set_progress("venue", "Starting venue load...", 0, 0)
        load_error: str | None = None
        load_error_status = 500

        try:
            try:
                snapshot = app.state.gateway.fetch_dashboard_snapshot(
                    session.client,
                    venueId,
                    progress_callback=set_progress,
                )
            except DashboardFetchError as exc:
                load_error = str(exc)
                load_error_status = 400
                set_progress("error", load_error, 0, 0, done=True, error=load_error)
                raise HTTPException(status_code=400, detail=load_error) from exc
            except Exception as exc:
                logger.exception("Unhandled dashboard fetch error for venue %s", venueId)
                load_error = "The dashboard could not be loaded from OpenReview."
                load_error_status = 502
                set_progress("error", load_error, 0, 0, done=True, error=load_error)
                raise HTTPException(status_code=502, detail=load_error) from exc

            try:
                logger.warning("Building dashboard response for venue %s", venueId)
                payload = build_dashboard_response(snapshot, venueId, progress_callback=set_progress)
                logger.warning("Built dashboard response for venue %s", venueId)
            except Exception as exc:
                logger.exception("Unhandled dashboard build error for venue %s", venueId)
                load_error = "The dashboard could not be built from the OpenReview response."
                load_error_status = 500
                set_progress("error", load_error, 0, 0, done=True, error=load_error)
                raise HTTPException(
                    status_code=500,
                    detail=load_error,
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
        finally:
            if dashboard_load is not None:
                app.state.sessions.finish_dashboard_load(
                    session_id,
                    venueId,
                    dashboard_load,
                    error=load_error,
                    status_code=load_error_status,
                )

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
