"""Order and order-line models, plus the order status state machine."""

from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.utils.time import utcnow


class OrderStatus(str, enum.Enum):
    """Lifecycle of an order.

    The string values are what the API and UI display, so they read as
    human labels rather than internal codes.
    """

    RECEIVED = "Order Received"
    PREPARING = "Preparing"
    OUT_FOR_DELIVERY = "Out for Delivery"
    DELIVERED = "Delivered"
    CANCELLED = "Cancelled"

    @property
    def is_terminal(self) -> bool:
        return self in _TERMINAL_STATUSES

    @property
    def next_status(self) -> OrderStatus | None:
        """The next status the simulator would advance to, if any."""
        return _PROGRESSION.get(self)

    def can_transition_to(self, target: OrderStatus) -> bool:
        return target in ALLOWED_TRANSITIONS[self]


_TERMINAL_STATUSES = frozenset({OrderStatus.DELIVERED, OrderStatus.CANCELLED})

# The happy path the background simulator walks automatically.
_PROGRESSION: dict[OrderStatus, OrderStatus] = {
    OrderStatus.RECEIVED: OrderStatus.PREPARING,
    OrderStatus.PREPARING: OrderStatus.OUT_FOR_DELIVERY,
    OrderStatus.OUT_FOR_DELIVERY: OrderStatus.DELIVERED,
}

# Every legal manual transition. Orders never move backwards, and terminal
# states are final -- a delivered order cannot be cancelled after the fact.
ALLOWED_TRANSITIONS: dict[OrderStatus, frozenset[OrderStatus]] = {
    OrderStatus.RECEIVED: frozenset({OrderStatus.PREPARING, OrderStatus.CANCELLED}),
    OrderStatus.PREPARING: frozenset({OrderStatus.OUT_FOR_DELIVERY, OrderStatus.CANCELLED}),
    OrderStatus.OUT_FOR_DELIVERY: frozenset({OrderStatus.DELIVERED}),
    OrderStatus.DELIVERED: frozenset(),
    OrderStatus.CANCELLED: frozenset(),
}

# Statuses a customer is still allowed to cancel from.
CANCELLABLE_STATUSES = frozenset({OrderStatus.RECEIVED, OrderStatus.PREPARING})


class Order(Base):
    """A placed order plus its delivery details.

    `public_id` is a random UUID and is the only identifier exposed by the
    API. Sequential integer ids would let anyone walk `/orders/1`,
    `/orders/2`, ... and read other customers' names, addresses and phone
    numbers, since this feature has no login.
    """

    __tablename__ = "orders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    public_id: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        index=True,
        default=lambda: str(uuid.uuid4()),
    )

    customer_name: Mapped[str] = mapped_column(String(120), nullable=False)
    phone: Mapped[str] = mapped_column(String(32), nullable=False)
    address: Mapped[str] = mapped_column(Text, nullable=False)
    notes: Mapped[str] = mapped_column(Text, nullable=False, default="")

    status: Mapped[OrderStatus] = mapped_column(
        Enum(OrderStatus, native_enum=False, length=32),
        nullable=False,
        default=OrderStatus.RECEIVED,
        index=True,
    )

    # Money is recomputed server-side from the menu; the client never sends it.
    subtotal_cents: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    delivery_fee_cents: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_cents: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, index=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    items: Mapped[list[OrderItem]] = relationship(
        back_populates="order",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    events: Mapped[list[OrderStatusEvent]] = relationship(
        back_populates="order",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="OrderStatusEvent.created_at",
    )

    @property
    def item_count(self) -> int:
        """Total number of units in the order, not the number of distinct lines."""
        return sum(item.quantity for item in self.items)

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<Order public_id={self.public_id} status={self.status.value!r}>"


class OrderItem(Base):
    """One line of an order.

    Name and unit price are snapshotted at purchase time. If the kitchen
    later renames a dish or changes its price, past orders and their totals
    must not silently change.
    """

    __tablename__ = "order_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    order_id: Mapped[int] = mapped_column(
        ForeignKey("orders.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Kept nullable so deleting a menu item does not destroy order history.
    menu_item_id: Mapped[int | None] = mapped_column(
        ForeignKey("menu_items.id", ondelete="SET NULL"), nullable=True
    )

    name: Mapped[str] = mapped_column(String(120), nullable=False)
    unit_price_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    image_url: Mapped[str] = mapped_column(String(500), nullable=False, default="")

    order: Mapped[Order] = relationship(back_populates="items")

    @property
    def line_total_cents(self) -> int:
        return self.unit_price_cents * self.quantity


class OrderStatusEvent(Base):
    """Append-only audit trail of status changes, used to render the timeline."""

    __tablename__ = "order_status_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    order_id: Mapped[int] = mapped_column(
        ForeignKey("orders.id", ondelete="CASCADE"), nullable=False, index=True
    )
    status: Mapped[OrderStatus] = mapped_column(
        Enum(OrderStatus, native_enum=False, length=32), nullable=False
    )
    note: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    order: Mapped[Order] = relationship(back_populates="events")
