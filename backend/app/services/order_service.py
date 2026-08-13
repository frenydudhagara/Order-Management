"""Order business rules.

The service owns the invariants: prices come from the menu (never the client),
status changes follow the state machine, and every change is both recorded as
an event and announced to subscribers.
"""

from __future__ import annotations

import logging

from app.errors import (
    InvalidStatusTransitionError,
    MenuItemNotFoundError,
    OrderNotCancellableError,
    OrderNotFoundError,
)
from app.models import CANCELLABLE_STATUSES, MenuItem, Order, OrderItem, OrderStatus
from app.realtime.connection_manager import NullPublisher, OrderEventPublisher
from app.repositories import MenuRepository, OrderRepository
from app.schemas.order import OrderCreate
from app.services.pricing import calculate_total

logger = logging.getLogger(__name__)

# Customer-facing copy for each automatic step.
STATUS_NOTES: dict[OrderStatus, str] = {
    OrderStatus.RECEIVED: "We have your order and sent it to the restaurant.",
    OrderStatus.PREPARING: "The kitchen has started cooking your food.",
    OrderStatus.OUT_FOR_DELIVERY: "Your rider has picked up the order.",
    OrderStatus.DELIVERED: "Delivered. Enjoy your meal!",
    OrderStatus.CANCELLED: "This order was cancelled.",
}


class OrderService:
    def __init__(
        self,
        orders: OrderRepository,
        menu: MenuRepository,
        publisher: OrderEventPublisher | None = None,
    ) -> None:
        self._orders = orders
        self._menu = menu
        self._publisher = publisher or NullPublisher()

    # -- reads -----------------------------------------------------------

    def get_order(self, public_id: str) -> Order:
        order = self._orders.get_by_public_id(public_id)
        if order is None:
            raise OrderNotFoundError(public_id)
        return order

    def list_recent(self, *, limit: int = 20, offset: int = 0) -> list[Order]:
        return self._orders.list_recent(limit=limit, offset=offset)

    def list_by_ids(self, public_ids: list[str]) -> list[Order]:
        return self._orders.list_by_public_ids(public_ids)

    # -- writes ----------------------------------------------------------

    def create_order(self, payload: OrderCreate) -> Order:
        """Turn a validated checkout payload into a persisted order.

        Menu items are resolved in one batched query. Unit prices are read from
        the database, so a client that posts its own prices cannot influence
        the total.
        """
        requested_ids = [item.menu_item_id for item in payload.items]
        found: dict[int, MenuItem] = self._menu.get_available_by_ids(requested_ids)

        missing = [item_id for item_id in requested_ids if item_id not in found]
        if missing:
            raise MenuItemNotFoundError(missing)

        lines: list[OrderItem] = []
        for requested in payload.items:
            menu_item = found[requested.menu_item_id]
            lines.append(
                OrderItem(
                    menu_item_id=menu_item.id,
                    name=menu_item.name,
                    unit_price_cents=menu_item.price_cents,
                    quantity=requested.quantity,
                    image_url=menu_item.image_url,
                )
            )

        breakdown = calculate_total([line.line_total_cents for line in lines])

        order = Order(
            customer_name=payload.customer_name,
            phone=payload.phone,
            address=payload.address,
            notes=payload.notes,
            status=OrderStatus.RECEIVED,
            subtotal_cents=breakdown.subtotal_cents,
            delivery_fee_cents=breakdown.delivery_fee_cents,
            total_cents=breakdown.total_cents,
            items=lines,
        )
        order = self._orders.add(order)

        self._orders.record_event(order, OrderStatus.RECEIVED, STATUS_NOTES[OrderStatus.RECEIVED])
        self._orders.commit()
        self._orders.refresh(order)

        logger.info("order created id=%s total_cents=%d", order.public_id, order.total_cents)
        self._announce(order, "order.created")
        return order

    def update_status(
        self,
        public_id: str,
        target: OrderStatus,
        *,
        note: str = "",
    ) -> Order:
        """Move an order to `target`, refusing illegal jumps.

        Re-applying the current status is treated as a no-op rather than an
        error, so a retried request stays safe.
        """
        order = self.get_order(public_id)

        if order.status is target:
            return order

        if not order.status.can_transition_to(target):
            raise InvalidStatusTransitionError(order.status.value, target.value)

        return self._apply_status(order, target, note or STATUS_NOTES.get(target, ""))

    def cancel_order(self, public_id: str) -> Order:
        """Customer-initiated cancellation, allowed only before dispatch."""
        order = self.get_order(public_id)
        if order.status not in CANCELLABLE_STATUSES:
            raise OrderNotCancellableError(order.status.value)
        return self._apply_status(
            order,
            OrderStatus.CANCELLED,
            "Cancelled at the customer's request.",
        )

    def advance_status(self, order: Order) -> Order | None:
        """Move an order one step along the happy path.

        Used by the background simulator. Returns None when the order has
        reached a terminal state and there is nothing left to do.
        """
        next_status = order.status.next_status
        if next_status is None:
            return None
        return self._apply_status(order, next_status, STATUS_NOTES.get(next_status, ""))

    # -- internals -------------------------------------------------------

    def _apply_status(self, order: Order, target: OrderStatus, note: str) -> Order:
        order.status = target
        self._orders.record_event(order, target, note)
        self._orders.commit()
        self._orders.refresh(order)
        logger.info("order %s -> %s", order.public_id, target.value)
        self._announce(order, "order.status_changed")
        return order

    def _announce(self, order: Order, event_type: str) -> None:
        """Push the full order to subscribers.

        Sending the whole resource rather than just the new status means the
        client can render from the message alone and never needs a follow-up
        request to stay consistent.
        """
        # Imported here to avoid a circular import at module load time.
        from app.schemas.order import OrderRead

        payload = OrderRead.model_validate(order).model_dump(mode="json")
        self._publisher.publish(order.public_id, event_type, payload)
