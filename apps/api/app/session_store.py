from __future__ import annotations

import secrets
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Optional

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
    created_at: float
    last_accessed_at: float
    cache: Dict[str, CachedDashboard] = field(default_factory=dict)
    progress: Dict[str, CachedProgress] = field(default_factory=dict)
    inflight_dashboard_loads: Dict[str, InflightDashboardLoad] = field(default_factory=dict)


class SessionStore:
    def __init__(
        self,
        cache_ttl_seconds: int = 180,
        session_ttl_seconds: int = 8 * 60 * 60,
        progress_ttl_seconds: int = 10 * 60,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self.cache_ttl_seconds = cache_ttl_seconds
        self.session_ttl_seconds = session_ttl_seconds
        self.progress_ttl_seconds = progress_ttl_seconds
        self._clock = clock
        self._sessions: Dict[str, SessionEntry] = {}
        self._lock = threading.Lock()

    @staticmethod
    def _close_client(client: Any) -> None:
        session = getattr(client, "session", None)
        close = getattr(session, "close", None)
        if callable(close):
            try:
                close()
            except Exception:
                pass

    def _prune_locked(self, now: float) -> None:
        expired_session_ids = []
        for session_id, session in self._sessions.items():
            if not session.inflight_dashboard_loads and now - session.last_accessed_at > self.session_ttl_seconds:
                expired_session_ids.append(session_id)
                continue

            expired_cache_keys = [
                venue_id
                for venue_id, cached in session.cache.items()
                if now - cached.stored_at > self.cache_ttl_seconds
            ]
            for venue_id in expired_cache_keys:
                session.cache.pop(venue_id, None)

            expired_progress_keys = [
                venue_id
                for venue_id, cached in session.progress.items()
                if now - cached.stored_at > self.progress_ttl_seconds
            ]
            for venue_id in expired_progress_keys:
                session.progress.pop(venue_id, None)

        for session_id in expired_session_ids:
            session = self._sessions.pop(session_id, None)
            if session is not None:
                self._close_client(session.client)

    def _touch_locked(self, session: SessionEntry, now: float) -> None:
        session.last_accessed_at = now

    def create_session(self, client: Any, viewer: ViewerInfo) -> str:
        session_id = secrets.token_urlsafe(32)
        with self._lock:
            now = self._clock()
            self._prune_locked(now)
            self._sessions[session_id] = SessionEntry(
                client=client,
                viewer=viewer,
                created_at=now,
                last_accessed_at=now,
            )
        return session_id

    def get_session(self, session_id: str) -> Optional[SessionEntry]:
        with self._lock:
            now = self._clock()
            self._prune_locked(now)
            session = self._sessions.get(session_id)
            if session is not None:
                self._touch_locked(session, now)
            return session

    def delete_session(self, session_id: str) -> None:
        with self._lock:
            session = self._sessions.pop(session_id, None)
            if session is not None:
                self._close_client(session.client)

    def begin_dashboard_load(self, session_id: str, venue_id: str) -> tuple[bool, Optional[InflightDashboardLoad]]:
        with self._lock:
            now = self._clock()
            self._prune_locked(now)
            session = self._sessions.get(session_id)
            if session is None:
                return False, None
            self._touch_locked(session, now)

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
            now = self._clock()
            self._prune_locked(now)
            session = self._sessions.get(session_id)
            if session is None:
                return
            self._touch_locked(session, now)
            session.cache[venue_id] = CachedDashboard(
                payload=payload,
                schema_version=DASHBOARD_CACHE_VERSION,
                stored_at=now,
            )

    def set_progress(self, session_id: str, venue_id: str, payload: DashboardLoadProgress) -> None:
        with self._lock:
            now = self._clock()
            self._prune_locked(now)
            session = self._sessions.get(session_id)
            if session is None:
                return
            self._touch_locked(session, now)
            session.progress[venue_id] = CachedProgress(payload=payload, stored_at=now)

    def get_progress(self, session_id: str, venue_id: str) -> Optional[DashboardLoadProgress]:
        with self._lock:
            now = self._clock()
            self._prune_locked(now)
            session = self._sessions.get(session_id)
            if session is None:
                return None
            self._touch_locked(session, now)

            cached = session.progress.get(venue_id)
            if cached is None:
                return None

            return _model_validate(DashboardLoadProgress, _model_dump(cached.payload))

    def clear_progress(self, session_id: str, venue_id: str) -> None:
        with self._lock:
            now = self._clock()
            self._prune_locked(now)
            session = self._sessions.get(session_id)
            if session is None:
                return
            self._touch_locked(session, now)
            session.progress.pop(venue_id, None)

    def get_cached_dashboard(self, session_id: str, venue_id: str) -> Optional[DashboardResponse]:
        with self._lock:
            now = self._clock()
            self._prune_locked(now)
            session = self._sessions.get(session_id)
            if session is None:
                return None
            self._touch_locked(session, now)

            cached = session.cache.get(venue_id)
            if cached is None:
                return None

            if cached.schema_version != DASHBOARD_CACHE_VERSION:
                session.cache.pop(venue_id, None)
                return None

            return _model_validate(DashboardResponse, _model_dump(cached.payload))

    def count(self) -> int:
        with self._lock:
            self._prune_locked(self._clock())
            return len(self._sessions)

    def prune(self) -> None:
        with self._lock:
            self._prune_locked(self._clock())

    def close_all(self) -> None:
        with self._lock:
            sessions = list(self._sessions.values())
            self._sessions.clear()
        for session in sessions:
            self._close_client(session.client)
