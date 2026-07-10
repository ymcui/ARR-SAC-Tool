from __future__ import annotations

from types import SimpleNamespace

from app.schemas import DashboardLoadProgress, ViewerInfo
from app.session_store import SessionStore


class FakeClock:
    def __init__(self) -> None:
        self.now = 100.0

    def __call__(self) -> float:
        return self.now


def test_session_store_expires_idle_sessions_and_closes_client() -> None:
    clock = FakeClock()
    client = SimpleNamespace(session=SimpleNamespace(close=lambda: setattr(client, "closed", True)), closed=False)
    store = SessionStore(session_ttl_seconds=10, clock=clock)
    session_id = store.create_session(client, ViewerInfo(id="~SAC1", fullname="SAC"))

    clock.now += 11

    assert store.get_session(session_id) is None
    assert client.closed is True


def test_session_store_prunes_finished_progress_without_expiring_active_session() -> None:
    clock = FakeClock()
    store = SessionStore(session_ttl_seconds=100, progress_ttl_seconds=5, clock=clock)
    session_id = store.create_session(object(), ViewerInfo(id="~SAC1", fullname="SAC"))
    store.set_progress(
        session_id,
        "venue",
        DashboardLoadProgress(
            venueId="venue",
            phase="ready",
            message="done",
            current=1,
            total=1,
            done=True,
        ),
    )

    clock.now += 6

    assert store.get_progress(session_id, "venue") is None
    assert store.get_session(session_id) is not None
