"""Real-time delivery over WebSocket.

These tests use the *real* `ConnectionManager` rather than the recording
double, so they exercise the whole push path: a sync request handler running in
a worker thread hands the broadcast back to the event loop, which writes it to
the socket.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

from app.api.deps import get_publisher
from app.database import get_db
from app.main import create_app
from app.middleware.rate_limit import limiter
from app.realtime import manager


@pytest.fixture
def realtime_client(session_factory, seeded_menu) -> Iterator[TestClient]:
    """A client whose publisher is the real WebSocket connection manager."""
    app = create_app()

    def _get_db() -> Iterator[Session]:
        session: Session = session_factory()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = _get_db
    app.dependency_overrides[get_publisher] = lambda: manager

    with TestClient(app) as client:
        limiter.reset()
        yield client

    app.dependency_overrides.clear()
    limiter.reset()


@pytest.fixture
def order(realtime_client, make_order_payload) -> dict[str, Any]:
    response = realtime_client.post("/api/orders", json=make_order_payload())
    assert response.status_code == 201
    return response.json()


def test_sends_a_snapshot_immediately_on_connect(realtime_client, order):
    """A client that connects late is instantly consistent without a REST call."""
    with realtime_client.websocket_connect(f"/api/ws/orders/{order['id']}") as ws:
        message = ws.receive_json()

    assert message["type"] == "snapshot"
    assert message["order_id"] == order["id"]
    assert message["data"]["status"] == "Order Received"
    assert message["data"]["items"]


def test_pushes_status_changes_to_a_subscriber(realtime_client, order):
    order_id = order["id"]

    with realtime_client.websocket_connect(f"/api/ws/orders/{order_id}") as ws:
        assert ws.receive_json()["type"] == "snapshot"

        realtime_client.patch(f"/api/orders/{order_id}/status", json={"status": "Preparing"})
        update = ws.receive_json()

    assert update["type"] == "order.status_changed"
    assert update["data"]["status"] == "Preparing"


def test_pushes_every_step_in_order(realtime_client, order):
    order_id = order["id"]

    with realtime_client.websocket_connect(f"/api/ws/orders/{order_id}") as ws:
        ws.receive_json()  # snapshot

        seen = []
        for target in ("Preparing", "Out for Delivery", "Delivered"):
            realtime_client.patch(f"/api/orders/{order_id}/status", json={"status": target})
            seen.append(ws.receive_json()["data"]["status"])

    assert seen == ["Preparing", "Out for Delivery", "Delivered"]


def test_pushes_cancellation(realtime_client, order):
    order_id = order["id"]

    with realtime_client.websocket_connect(f"/api/ws/orders/{order_id}") as ws:
        ws.receive_json()  # snapshot

        realtime_client.delete(f"/api/orders/{order_id}")
        update = ws.receive_json()

    assert update["data"]["status"] == "Cancelled"


def test_the_pushed_payload_is_a_complete_order(realtime_client, order):
    """Pushing the whole resource is what lets the UI render from the message
    alone rather than re-fetching."""
    order_id = order["id"]

    with realtime_client.websocket_connect(f"/api/ws/orders/{order_id}") as ws:
        ws.receive_json()
        realtime_client.patch(f"/api/orders/{order_id}/status", json={"status": "Preparing"})
        payload = ws.receive_json()["data"]

    assert set(payload) >= {
        "id",
        "status",
        "next_status",
        "items",
        "events",
        "total_cents",
        "created_at",
    }
    assert payload["next_status"] == "Out for Delivery"


def test_subscribers_do_not_receive_other_orders_updates(
    realtime_client, order, make_order_payload
):
    """Order updates are addressed, not broadcast to everyone."""
    other = realtime_client.post("/api/orders", json=make_order_payload()).json()

    with realtime_client.websocket_connect(f"/api/ws/orders/{order['id']}") as ws:
        ws.receive_json()  # snapshot for our order

        realtime_client.patch(f"/api/orders/{other['id']}/status", json={"status": "Preparing"})
        realtime_client.patch(f"/api/orders/{order['id']}/status", json={"status": "Preparing"})

        # The next message must be ours, not the other order's.
        message = ws.receive_json()

    assert message["order_id"] == order["id"]


def test_two_clients_watching_one_order_both_get_the_update(realtime_client, order):
    order_id = order["id"]

    with realtime_client.websocket_connect(f"/api/ws/orders/{order_id}") as first:
        with realtime_client.websocket_connect(f"/api/ws/orders/{order_id}") as second:
            first.receive_json()
            second.receive_json()

            realtime_client.patch(f"/api/orders/{order_id}/status", json={"status": "Preparing"})

            assert first.receive_json()["data"]["status"] == "Preparing"
            assert second.receive_json()["data"]["status"] == "Preparing"


def test_ping_is_answered_with_pong(realtime_client, order):
    """Keeps proxies from closing an idle connection."""
    with realtime_client.websocket_connect(f"/api/ws/orders/{order['id']}") as ws:
        ws.receive_json()  # snapshot
        ws.send_text("ping")

        assert ws.receive_json()["type"] == "pong"


def test_unrecognised_client_messages_are_ignored(realtime_client, order):
    order_id = order["id"]

    with realtime_client.websocket_connect(f"/api/ws/orders/{order_id}") as ws:
        ws.receive_json()
        ws.send_text('{"type": "DROP TABLE orders"}')

        # Connection stays usable and still delivers real updates.
        realtime_client.patch(f"/api/orders/{order_id}/status", json={"status": "Preparing"})
        assert ws.receive_json()["data"]["status"] == "Preparing"


def test_connecting_to_an_unknown_order_is_closed_with_a_distinct_code(realtime_client):
    """A dedicated close code lets the client tell "no such order" from
    "server unreachable" and skip pointless reconnect attempts."""
    from starlette.websockets import WebSocketDisconnect

    with pytest.raises(WebSocketDisconnect) as exc_info:
        with realtime_client.websocket_connect(f"/api/ws/orders/{uuid.uuid4()}") as ws:
            ws.receive_json()

    assert exc_info.value.code == 4404


def test_subscribers_are_forgotten_after_disconnect(realtime_client, order):
    """A leaked socket set would grow without bound over a long uptime."""
    order_id = order["id"]

    with realtime_client.websocket_connect(f"/api/ws/orders/{order_id}") as ws:
        ws.receive_json()
        assert manager.subscriber_count(order_id) == 1

    # Give the server a moment to run the disconnect cleanup.
    realtime_client.get("/api/health")

    assert manager.subscriber_count(order_id) == 0


def test_publishing_without_a_running_loop_is_a_no_op():
    """Unit tests use the service directly; that must not blow up on publish."""
    from app.realtime.connection_manager import ConnectionManager

    standalone = ConnectionManager()

    standalone.publish("some-id", "order.created", {})  # no loop bound


def test_broadcasting_to_nobody_is_harmless(session_factory: sessionmaker[Session]):
    import asyncio

    from app.realtime.connection_manager import ConnectionManager

    standalone = ConnectionManager()

    asyncio.run(standalone.broadcast("nobody-is-listening", "order.created", {}))
