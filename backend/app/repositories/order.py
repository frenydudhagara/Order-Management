"""Order data access."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Order, OrderStatus, OrderStatusEvent


class OrderRepository:
    def __init__(self, db: Session) -> None:
        self._db = db

    def add(self, order: Order) -> Order:
        self._db.add(order)
        self._db.commit()
        self._db.refresh(order)
        return order

    def get_by_public_id(self, public_id: str) -> Order | None:
        stmt = select(Order).where(Order.public_id == public_id)
        return self._db.scalars(stmt).first()

    def list_recent(self, *, limit: int = 20, offset: int = 0) -> list[Order]:
        stmt = (
            select(Order)
            .order_by(Order.created_at.desc(), Order.id.desc())
            .offset(offset)
            .limit(limit)
        )
        return list(self._db.scalars(stmt))

    def list_by_public_ids(self, public_ids: list[str]) -> list[Order]:
        """Used by the client to hydrate the order ids it holds in localStorage."""
        if not public_ids:
            return []
        stmt = (
            select(Order)
            .where(Order.public_id.in_(public_ids))
            .order_by(Order.created_at.desc(), Order.id.desc())
        )
        return list(self._db.scalars(stmt))

    def find_due_for_advance(self, *, older_than_seconds: float) -> list[Order]:
        """Active orders whose current status has been held long enough.

        The cutoff is computed against `updated_at`, so a manual status change
        also resets the clock for the automatic progression.
        """
        cutoff = datetime.now(timezone.utc) - timedelta(seconds=older_than_seconds)
        stmt = select(Order).where(
            Order.status.in_(
                [
                    OrderStatus.RECEIVED,
                    OrderStatus.PREPARING,
                    OrderStatus.OUT_FOR_DELIVERY,
                ]
            ),
            Order.updated_at <= cutoff,
        )
        return list(self._db.scalars(stmt))

    def record_event(self, order: Order, status: OrderStatus, note: str = "") -> OrderStatusEvent:
        event = OrderStatusEvent(order_id=order.id, status=status, note=note)
        self._db.add(event)
        return event

    def commit(self) -> None:
        self._db.commit()

    def refresh(self, order: Order) -> Order:
        self._db.refresh(order)
        return order
