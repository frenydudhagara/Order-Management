"""WebSocket endpoint for live order status.

Protocol
--------
Connect to `/api/ws/orders/{order_id}`. The server immediately sends the
current order as a `snapshot` message, so a client that connects late -- or
reconnects after a dropped network -- is instantly consistent without a
separate REST call. Subsequent changes arrive as `order.status_changed`.

    {"type": "snapshot",             "order_id": "...", "data": {<order>}}
    {"type": "order.status_changed", "order_id": "...", "data": {<order>}}
    {"type": "pong",                 "order_id": "...", "data": {}}

The client may send `"ping"` to keep intermediaries from idling the connection
out; anything else is ignored. The socket is only a transport for pushes --
mutations always go through the REST API, so there is no command surface here
to secure.
"""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.database import session_scope
from app.errors import OrderNotFoundError
from app.realtime import manager
from app.repositories import MenuRepository, OrderRepository
from app.schemas import OrderRead
from app.services import OrderService

logger = logging.getLogger(__name__)

router = APIRouter(tags=["realtime"])

_CLOSE_NOT_FOUND = 4404


def _load_order_payload(order_id: str) -> dict | None:
    """Read the order in its own short-lived session.

    A WebSocket outlives a request, so it must not hold a request-scoped
    session open for the life of the connection.
    """
    with session_scope() as db:
        service = OrderService(OrderRepository(db), MenuRepository(db))
        try:
            order = service.get_order(order_id)
        except OrderNotFoundError:
            return None
        return OrderRead.model_validate(order).model_dump(mode="json")


@router.websocket("/ws/orders/{order_id}")
async def order_updates(websocket: WebSocket, order_id: str) -> None:
    """Stream status changes for a single order."""
    snapshot = await asyncio.to_thread(_load_order_payload, order_id)
    if snapshot is None:
        # Accept first: a browser cannot read the close code of a handshake
        # that was rejected outright, so closing after accept is what lets the
        # client tell "no such order" from "server unreachable".
        await websocket.accept()
        await websocket.close(code=_CLOSE_NOT_FOUND, reason="Order not found")
        return

    await manager.connect(order_id, websocket)
    try:
        await websocket.send_json({"type": "snapshot", "order_id": order_id, "data": snapshot})
        while True:
            message = await websocket.receive_text()
            if message == "ping":
                await websocket.send_json({"type": "pong", "order_id": order_id, "data": {}})
    except WebSocketDisconnect:
        logger.debug("ws disconnected order=%s", order_id)
    except Exception:  # noqa: BLE001 - never let one socket bring down the app
        logger.exception("ws error order=%s", order_id)
    finally:
        await manager.disconnect(order_id, websocket)
