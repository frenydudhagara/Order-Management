"""The order status state machine, tested at the service layer."""

from __future__ import annotations

import pytest

from app.errors import InvalidStatusTransitionError, OrderNotCancellableError, OrderNotFoundError
from app.models import ALLOWED_TRANSITIONS, OrderStatus
from app.schemas import OrderCreate


@pytest.fixture
def order(order_service, seeded_menu, valid_delivery_details):
    payload = OrderCreate(
        **valid_delivery_details,
        items=[{"menu_item_id": seeded_menu[0].id, "quantity": 1}],
    )
    return order_service.create_order(payload)


# -- enum behaviour ------------------------------------------------------


def test_new_orders_start_as_received(order):
    assert order.status is OrderStatus.RECEIVED


def test_progression_follows_the_happy_path():
    assert OrderStatus.RECEIVED.next_status is OrderStatus.PREPARING
    assert OrderStatus.PREPARING.next_status is OrderStatus.OUT_FOR_DELIVERY
    assert OrderStatus.OUT_FOR_DELIVERY.next_status is OrderStatus.DELIVERED


@pytest.mark.parametrize("status", [OrderStatus.DELIVERED, OrderStatus.CANCELLED])
def test_terminal_statuses_have_nowhere_to_go(status):
    assert status.is_terminal
    assert status.next_status is None
    assert ALLOWED_TRANSITIONS[status] == frozenset()


def test_the_transition_table_covers_every_status():
    """A new status added to the enum must not be silently unreachable."""
    assert set(ALLOWED_TRANSITIONS) == set(OrderStatus)


# -- legal transitions ---------------------------------------------------


def test_walks_an_order_all_the_way_to_delivered(order_service, order):
    for expected in (
        OrderStatus.PREPARING,
        OrderStatus.OUT_FOR_DELIVERY,
        OrderStatus.DELIVERED,
    ):
        updated = order_service.update_status(order.public_id, expected)
        assert updated.status is expected


def test_each_change_is_appended_to_the_audit_trail(order_service, order):
    order_service.update_status(order.public_id, OrderStatus.PREPARING)
    order_service.update_status(order.public_id, OrderStatus.OUT_FOR_DELIVERY)

    refreshed = order_service.get_order(order.public_id)

    assert [event.status for event in refreshed.events] == [
        OrderStatus.RECEIVED,
        OrderStatus.PREPARING,
        OrderStatus.OUT_FOR_DELIVERY,
    ]


def test_every_automatic_step_carries_customer_facing_copy(order_service, order):
    order_service.update_status(order.public_id, OrderStatus.PREPARING)

    refreshed = order_service.get_order(order.public_id)

    assert all(event.note for event in refreshed.events)


# -- illegal transitions -------------------------------------------------


@pytest.mark.parametrize(
    ("start", "target"),
    [
        (OrderStatus.RECEIVED, OrderStatus.OUT_FOR_DELIVERY),  # skips preparing
        (OrderStatus.RECEIVED, OrderStatus.DELIVERED),  # skips everything
        (OrderStatus.PREPARING, OrderStatus.DELIVERED),  # skips dispatch
    ],
)
def test_refuses_to_skip_ahead(order_service, order, start, target):
    if start is not OrderStatus.RECEIVED:
        order_service.update_status(order.public_id, start)

    with pytest.raises(InvalidStatusTransitionError) as exc_info:
        order_service.update_status(order.public_id, target)

    assert exc_info.value.status_code == 409


def test_refuses_to_move_backwards(order_service, order):
    order_service.update_status(order.public_id, OrderStatus.PREPARING)

    with pytest.raises(InvalidStatusTransitionError):
        order_service.update_status(order.public_id, OrderStatus.RECEIVED)


def test_a_delivered_order_is_frozen(order_service, order):
    for status in (
        OrderStatus.PREPARING,
        OrderStatus.OUT_FOR_DELIVERY,
        OrderStatus.DELIVERED,
    ):
        order_service.update_status(order.public_id, status)

    with pytest.raises(InvalidStatusTransitionError):
        order_service.update_status(order.public_id, OrderStatus.CANCELLED)


def test_a_cancelled_order_cannot_be_resurrected(order_service, order):
    order_service.cancel_order(order.public_id)

    with pytest.raises(InvalidStatusTransitionError):
        order_service.update_status(order.public_id, OrderStatus.PREPARING)


def test_reapplying_the_current_status_is_a_no_op(order_service, order, publisher):
    """Makes a retried request safe instead of an error."""
    publisher.clear()

    result = order_service.update_status(order.public_id, OrderStatus.RECEIVED)

    assert result.status is OrderStatus.RECEIVED
    assert len(result.events) == 1
    assert publisher.events == []


def test_updating_an_unknown_order_raises_not_found(order_service):
    with pytest.raises(OrderNotFoundError):
        order_service.update_status("00000000-0000-4000-8000-000000000000", OrderStatus.PREPARING)


# -- cancellation --------------------------------------------------------


@pytest.mark.parametrize("start", [OrderStatus.RECEIVED, OrderStatus.PREPARING])
def test_can_cancel_before_dispatch(order_service, order, start):
    if start is not OrderStatus.RECEIVED:
        order_service.update_status(order.public_id, start)

    cancelled = order_service.cancel_order(order.public_id)

    assert cancelled.status is OrderStatus.CANCELLED


def test_cannot_cancel_after_dispatch(order_service, order):
    order_service.update_status(order.public_id, OrderStatus.PREPARING)
    order_service.update_status(order.public_id, OrderStatus.OUT_FOR_DELIVERY)

    with pytest.raises(OrderNotCancellableError):
        order_service.cancel_order(order.public_id)


# -- advance (used by the simulator) -------------------------------------


def test_advance_moves_one_step(order_service, order):
    advanced = order_service.advance_status(order)

    assert advanced is not None
    assert advanced.status is OrderStatus.PREPARING


def test_advance_returns_none_at_the_end_of_the_line(order_service, order):
    for status in (
        OrderStatus.PREPARING,
        OrderStatus.OUT_FOR_DELIVERY,
        OrderStatus.DELIVERED,
    ):
        order_service.update_status(order.public_id, status)

    assert order_service.advance_status(order) is None


def test_advance_does_not_revive_a_cancelled_order(order_service, order):
    cancelled = order_service.cancel_order(order.public_id)

    assert order_service.advance_status(cancelled) is None


# -- realtime announcements ----------------------------------------------


def test_creating_an_order_announces_it(order_service, order, publisher):
    assert publisher.types_for(order.public_id) == ["order.created"]


def test_each_status_change_is_announced(order_service, order, publisher):
    publisher.clear()

    order_service.update_status(order.public_id, OrderStatus.PREPARING)

    assert publisher.types_for(order.public_id) == ["order.status_changed"]


def test_the_announcement_carries_the_whole_order(order_service, order, publisher):
    """Sending the full resource means the client never needs a follow-up GET."""
    publisher.clear()
    order_service.update_status(order.public_id, OrderStatus.PREPARING)

    payload = publisher.last_payload

    assert payload["id"] == order.public_id
    assert payload["status"] == "Preparing"
    assert payload["total_cents"] == order.total_cents
    assert payload["items"]
    assert payload["events"]
