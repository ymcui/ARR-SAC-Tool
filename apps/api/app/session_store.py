from __future__ import annotations

import secrets
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Dict, Optional

from app.schemas import DashboardLoadProgress, DashboardResponse, ViewerInfo

DASHBOARD_CACHE_VERSION = 11


def _model_dump(model: Any) -> dict:
    if hasattr(model, "model_dump"):
        return model.model_dump()
    return model.dict()


def _model_validate(model_cls, payload: dict):
    if hasattr(model_cls, "model_validate"):
        return model_cls.model_validate(payload)
    return model_cls.parse_obj(payload)


@dataclass
class CachedDashboard:
    payload: DashboardResponse
    stored_at: float
    schema_version: int = DASHBOARD_CACHE_VERSION


@dataclass
class CachedProgress:
    payload: DashboardLoadProgress
    stored_at: float


@dataclass
class InflightDashboardLoad:
    event: threading.Event = field(default_factory=threading.Event)
    started_at: float = field(default_factory=time.time)
    error: str | None = None
    status_code: int = 500


@dataclass
class SessionEntry:
    client: Any
    viewer: ViewerInfo
    cache: Dict[str, CachedDashboard] = field(default_factory=dict)
    progress: Dict[str, CachedProgress] = field(default_factory=dict)
    inflight_dashboard_loads: Dict[str, InflightDashboardLoad] = field(default_factory=dict)


class SessionStore:
    def __init__(self, cache_ttl_seconds: int = 180) -> None:
        self.cache_ttl_seconds = cache_ttl_seconds
        self._sessions: Dict[str, SessionEntry] = {}
        self._lock = threading.Lock()

    def create_session(self, client: Any, viewer: ViewerInfo) -> str:
        session_id = secrets.token_urlsafe(32)
        with self._lock:
            self._sessions[session_id] = SessionEntry(client=client, viewer=viewer)
        return session_id

    def get_session(self, session_id: str) -> Optional[SessionEntry]:
        with self._lock:
            return self._sessions.get(session_id)

    def delete_session(self, session_id: str) -> None:
        with self._lock:
            self._sessions.pop(session_id, None)

    def begin_dashboard_load(self, session_id: str, venue_id: str) -> tuple[bool, Optional[InflightDashboardLoad]]:
        with self._lock:
            session = self._sessions.get(session_id)
            if session is None:
                return False, None

            existing = session.inflight_dashboard_loads.get(venue_id)
            if existing is not None and not existing.event.is_set():
                return False, existing

            load = InflightDashboardLoad()
            session.inflight_dashboard_loads[venue_id] = load
            return True, load

    def finish_dashboard_load(
        self,
        session_id: str,
        venue_id: str,
        load: InflightDashboardLoad,
        *,
        error: str | None = None,
        status_code: int = 500,
    ) -> None:
        with self._lock:
            session = self._sessions.get(session_id)
            if session is not None and session.inflight_dashboard_loads.get(venue_id) is load:
                session.inflight_dashboard_loads.pop(venue_id, None)

            load.error = error
            load.status_code = status_code
            load.event.set()

    def cache_dashboard(self, session_id: str, venue_id: str, payload: DashboardResponse) -> None:
        with self._lock:
            session = self._sessions.get(session_id)
            if session is None:
                return
            session.cache[venue_id] = CachedDashboard(
                payload=payload,
                schema_version=DASHBOARD_CACHE_VERSION,
                stored_at=time.time(),
            )

    def set_progress(self, session_id: str, venue_id: str, payload: DashboardLoadProgress) -> None:
        with self._lock:
            session = self._sessions.get(session_id)
            if session is None:
                return
            session.progress[venue_id] = CachedProgress(payload=payload, stored_at=time.time())

    def get_progress(self, session_id: str, venue_id: str) -> Optional[DashboardLoadProgress]:
        with self._lock:
            session = self._sessions.get(session_id)
            if session is None:
                return None

            cached = session.progress.get(venue_id)
            if cached is None:
                return None

            return _model_validate(DashboardLoadProgress, _model_dump(cached.payload))

    def clear_progress(self, session_id: str, venue_id: str) -> None:
        with self._lock:
            session = self._sessions.get(session_id)
            if session is None:
                return
            session.progress.pop(venue_id, None)

    def get_cached_dashboard(self, session_id: str, venue_id: str) -> Optional[DashboardResponse]:
        with self._lock:
            session = self._sessions.get(session_id)
            if session is None:
                return None

            cached = session.cache.get(venue_id)
            if cached is None:
                return None

            if cached.schema_version != DASHBOARD_CACHE_VERSION:
                session.cache.pop(venue_id, None)
                return None

            if time.time() - cached.stored_at > self.cache_ttl_seconds:
                session.cache.pop(venue_id, None)
                return None

            return _model_validate(DashboardResponse, _model_dump(cached.payload))

    def count(self) -> int:
        with self._lock:
            return len(self._sessions)
