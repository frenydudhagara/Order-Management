"""Background task that walks orders through their lifecycle.

The brief asks for status progression to be simulated in the back-end. Rather
than scheduling a timer per order -- which would lose every pending transition
on restart -- the simulator polls for orders whose current status has been held
longer than `status_step_seconds`. State lives in the database, so a restart
picks up exactly where it left off.

Database work is pushed onto a worker thread with `asyncio.to_thread` so the
blocking SQLAlchemy calls never hold up the event loop serving WebSockets.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from contextlib import AbstractContextManager

from sqlalchemy.orm import Session

from app.realtime.connection_manager import OrderEventPublisher
from app.repositories import MenuRepository, OrderRepository
from app.services.order_service import OrderService

logger = logging.getLogger(__name__)


class StatusSimulator:
    def __init__(
        self,
        session_factory: Callable[[], AbstractContextManager[Session]],
        publisher: OrderEventPublisher,
        *,
        step_seconds: float,
        tick_seconds: float,
    ) -> None:
        self._session_factory = session_factory
        self._publisher = publisher
        self._step_seconds = step_seconds
        self._tick_seconds = tick_seconds
        self._task: asyncio.Task[None] | None = None

    @property
    def is_running(self) -> bool:
        return self._task is not None and not self._task.done()

    async def start(self) -> None:
        if self.is_running:
            return
        self._task = asyncio.create_task(self._run(), name="order-status-simulator")
        logger.info(
            "status simulator started (step=%.1fs tick=%.1fs)",
            self._step_seconds,
            self._tick_seconds,
        )

    async def stop(self) -> None:
        if self._task is None:
            return
        self._task.cancel()
        try:
            await self._task
        except asyncio.CancelledError:
            pass
        finally:
            self._task = None
            logger.info("status simulator stopped")

    async def _run(self) -> None:
        while True:
            try:
                await asyncio.sleep(self._tick_seconds)
                await asyncio.to_thread(self.tick)
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001 - one bad tick must not kill the loop
                logger.exception("status simulator tick failed")

    def tick(self) -> int:
        """Advance every order that is due. Returns how many moved.

        Exposed as a plain synchronous method so tests can drive the simulation
        deterministically instead of waiting on wall-clock time.
        """
        advanced = 0
        with self._session_factory() as db:
            orders = OrderRepository(db)
            service = OrderService(orders, MenuRepository(db), self._publisher)
            due = orders.find_due_for_advance(older_than_seconds=self._step_seconds)
            for order in due:
                if service.advance_status(order) is not None:
                    advanced += 1
        if advanced:
            logger.info("simulator advanced %d order(s)", advanced)
        return advanced
