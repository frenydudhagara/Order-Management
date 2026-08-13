"""Shared test fixtures.

Isolation strategy: every test gets a fresh in-memory SQLite database. A
`StaticPool` keeps all connections pointed at the *same* in-memory database,
which matters because the app opens sessions from several places (request
handlers, the WebSocket handler, the simulator) and each would otherwise get
its own empty database.

The background simulator is disabled by default and driven explicitly with
`simulator.tick()`, so status assertions never depend on wall-clock timing.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from typing import Any

import pytest

# Must be set before app.config is imported anywhere.
os.environ.setdefault("ENABLE_STATUS_SIMULATOR", "false")
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("ENVIRONMENT", "test")

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import Session, sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app import database  # noqa: E402
from app.api.deps import get_publisher  # noqa: E402
from app.database import Base, get_db  # noqa: E402
from app.main import create_app  # noqa: E402
from app.middleware.rate_limit import limiter  # noqa: E402
from app.repositories import MenuRepository, OrderRepository  # noqa: E402
from app.seed import seed_menu  # noqa: E402
from app.services import MenuService, OrderService  # noqa: E402


class RecordingPublisher:
    """Test double capturing every realtime event the service emits."""

    def __init__(self) -> None:
        self.events: list[tuple[str, str, dict[str, Any]]] = []

    def publish(self, order_id: str, event_type: str, payload: dict[str, Any]) -> None:
        self.events.append((order_id, event_type, payload))

    def types_for(self, order_id: str) -> list[str]:
        return [event for oid, event, _ in self.events if oid == order_id]

    @property
    def last_payload(self) -> dict[str, Any]:
        return self.events[-1][2]

    def clear(self) -> None:
        self.events.clear()


@pytest.fixture
def engine():
    """A private in-memory database for one test."""
    test_engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=test_engine)
    try:
        yield test_engine
    finally:
        Base.metadata.drop_all(bind=test_engine)
        test_engine.dispose()


@pytest.fixture
def session_factory(engine, monkeypatch) -> sessionmaker[Session]:
    """Point every part of the app at the test database.

    `session_scope` and `get_db` resolve `database.SessionLocal` at call time,
    so patching that one attribute redirects request handlers, the WebSocket
    handler and the simulator together.
    """
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    monkeypatch.setattr(database, "SessionLocal", factory)
    monkeypatch.setattr(database, "engine", engine)
    return factory


@pytest.fixture
def db(session_factory) -> Iterator[Session]:
    session = session_factory()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def seeded_menu(db) -> list:
    """Insert the standard menu and return the items."""
    seed_menu(db)
    return MenuRepository(db).list_items()


@pytest.fixture
def publisher() -> RecordingPublisher:
    return RecordingPublisher()


@pytest.fixture
def order_service(db, publisher) -> OrderService:
    """Service wired directly, for tests that do not need HTTP."""
    return OrderService(OrderRepository(db), MenuRepository(db), publisher)


@pytest.fixture
def menu_service(db) -> MenuService:
    return MenuService(MenuRepository(db))


@pytest.fixture
def client(session_factory, publisher, seeded_menu) -> Iterator[TestClient]:
    """A TestClient bound to the isolated database and recording publisher."""
    app = create_app()
    app.dependency_overrides[get_db] = _override_get_db(session_factory)
    app.dependency_overrides[get_publisher] = lambda: publisher

    with TestClient(app) as test_client:
        limiter.reset()  # counters are process-wide; don't leak between tests
        yield test_client

    app.dependency_overrides.clear()
    limiter.reset()


def _override_get_db(factory: sessionmaker[Session]):
    def _get_db() -> Iterator[Session]:
        session = factory()
        try:
            yield session
        finally:
            session.close()

    return _get_db


# -- convenience builders ------------------------------------------------


@pytest.fixture
def valid_delivery_details() -> dict[str, str]:
    return {
        "customer_name": "Priya Sharma",
        "phone": "+44 20 7946 0958",
        "address": "42 Wallaby Way, Sydney, NSW 2000",
        "notes": "Ring the bell twice.",
    }


@pytest.fixture
def make_order_payload(valid_delivery_details, seeded_menu):
    """Build a valid checkout payload, overridable per test."""

    def _build(**overrides: Any) -> dict[str, Any]:
        payload: dict[str, Any] = {
            **valid_delivery_details,
            "items": [{"menu_item_id": seeded_menu[0].id, "quantity": 1}],
        }
        payload.update(overrides)
        return payload

    return _build


@pytest.fixture
def placed_order(client, make_order_payload) -> dict[str, Any]:
    """An order that already exists, as returned by the API."""
    response = client.post("/api/orders", json=make_order_payload())
    assert response.status_code == 201, response.text
    return response.json()
