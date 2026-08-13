"""WebSocket fan-out for order updates.

Why a thread-safe publish path exists
-------------------------------------
Route handlers that touch the database are declared `def`, not `async def`, so
FastAPI runs them in a worker thread and blocking SQLAlchemy calls never stall
the event loop. But sending on a WebSocket is a coroutine, and awaiting one
from a worker thread is not possible. `publish()` therefore hands the
broadcast back to the event loop with `run_coroutine_threadsafe`, which is the
supported way to cross that boundary. Callers already inside the loop can
`await broadcast()` directly.

Scope: this is single-process fan-out. Behind multiple workers, each process
would only reach its own clients; the fix is a shared broker (Redis pub/sub)
behind the same `publish()` interface. Noted rather than built -- the exercise
runs as one process, and the frontend also polls as a fallback.
"""

from __future__ import annotations

import asyncio
import logging
from collections import defaultdict
from typing import Any, Protocol, runtime_checkable

from starlette.websockets import WebSocket, WebSocketState

logger = logging.getLogger(__name__)


@runtime_checkable
class OrderEventPublisher(Protocol):
    """What the service layer needs in order to announce a change.

    Depending on this instead of on `ConnectionManager` keeps the service free
    of transport details and trivial to test with a recording double.
    """

    def publish(self, order_id: str, event_type: str, payload: dict[str, Any]) -> None: ...


class NullPublisher:
    """No-op publisher, used in tests and when realtime is disabled."""

    def publish(self, order_id: str, event_type: str, payload: dict[str, Any]) -> None:
        return None


class ConnectionManager:
    """Tracks WebSocket subscribers per order id."""

    def __init__(self) -> None:
        self._connections: dict[str, set[WebSocket]] = defaultdict(set)
        self._lock = asyncio.Lock()
        self._loop: asyncio.AbstractEventLoop | None = None

    # -- lifecycle -------------------------------------------------------

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        """Remember the serving loop so worker threads can reach it."""
        self._loop = loop

    async def connect(self, order_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self._connections[order_id].add(websocket)
        logger.info("ws connected order=%s subscribers=%d", order_id, self.subscriber_count(order_id))

    async def disconnect(self, order_id: str, websocket: WebSocket) -> None:
        async with self._lock:
            self._connections[order_id].discard(websocket)
            if not self._connections[order_id]:
                del self._connections[order_id]

    def subscriber_count(self, order_id: str) -> int:
        return len(self._connections.get(order_id, ()))

    # -- delivery --------------------------------------------------------

    async def broadcast(self, order_id: str, event_type: str, payload: dict[str, Any]) -> None:
        """Send one message to every subscriber of `order_id`."""
        async with self._lock:
            targets = list(self._connections.get(order_id, ()))
        if not targets:
            return

        message = {"type": event_type, "order_id": order_id, "data": payload}
        dead: list[WebSocket] = []
        for websocket in targets:
            if websocket.client_state is not WebSocketState.CONNECTED:
                dead.append(websocket)
                continue
            try:
                await websocket.send_json(message)
            except Exception:  # noqa: BLE001 - a broken socket must not stop the rest
                logger.debug("dropping dead websocket for order=%s", order_id, exc_info=True)
                dead.append(websocket)

        for websocket in dead:
            await self.disconnect(order_id, websocket)

    def publish(self, order_id: str, event_type: str, payload: dict[str, Any]) -> None:
        """Thread-safe broadcast, callable from sync code in a worker thread."""
        loop = self._loop
        if loop is None or loop.is_closed():
            # No server running (e.g. a unit test using the service directly).
            return
        try:
            asyncio.run_coroutine_threadsafe(
                self.broadcast(order_id, event_type, payload), loop
            )
        except RuntimeError:  # pragma: no cover - loop shutting down mid-request
            logger.debug("could not schedule broadcast for order=%s", order_id)

    async def close_all(self) -> None:
        """Close every socket on shutdown so clients reconnect cleanly."""
        async with self._lock:
            everything = [(oid, ws) for oid, sockets in self._connections.items() for ws in sockets]
            self._connections.clear()
        for _, websocket in everything:
            try:
                await websocket.close(code=1001)
            except Exception:  # noqa: BLE001
                pass


# Process-wide instance; injected into services via FastAPI dependencies.
manager = ConnectionManager()
