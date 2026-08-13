"""The background status simulator.

`tick()` is driven directly instead of sleeping, so these tests are fast and
deterministic. Timing is expressed by backdating `updated_at`, which is exactly
what the simulator reads.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.models import Order, OrderStatus
from app.schemas import OrderCreate
from app.services.status_simulator import StatusSimulator

STEP_SECONDS = 30.0


@pytest.fixture
def simulator(session_factory, publisher) -> StatusSimulator:
    return StatusSimulator(
        session_factory,
        publisher,
        step_seconds=STEP_SECONDS,
        tick_seconds=0.01,
    )


@pytest.fixture
def make_order(order_service, seeded_menu, valid_delivery_details):
    def _make() -> Order:
        return order_service.create_order(
            OrderCreate(
                **valid_delivery_details,
                items=[{"menu_item_id": seeded_menu[0].id, "quantity": 1}],
            )
        )

    return _make


def backdate(db, order: Order, seconds: float) -> None:
    """Pretend the order has been sitting in its current status for a while."""
    row = db.get(Order, order.id)
    row.updated_at = datetime.now(timezone.utc) - timedelta(seconds=seconds)
    db.commit()


def test_leaves_an_order_alone_before_its_step_elapses(simulator, make_order, db):
    order = make_order()

    assert simulator.tick() == 0
    assert db.get(Order, order.id).status is OrderStatus.RECEIVED


def test_advances_an_order_once_its_step_has_elapsed(simulator, make_order, db):
    order = make_order()
    backdate(db, order, STEP_SECONDS + 1)

    assert simulator.tick() == 1
    db.expire_all()
    assert db.get(Order, order.id).status is OrderStatus.PREPARING


def test_advances_one_step_per_tick_not_all_at_once(simulator, make_order, db):
    """A single overdue order must not jump straight to Delivered."""
    order = make_order()
    backdate(db, order, STEP_SECONDS * 10)

    simulator.tick()
    db.expire_all()

    assert db.get(Order, order.id).status is OrderStatus.PREPARING


def test_walks_all_the_way_to_delivered_over_successive_ticks(simulator, make_order, db):
    order = make_order()
    seen = []

    for _ in range(3):
        backdate(db, order, STEP_SECONDS + 1)
        simulator.tick()
        db.expire_all()
        seen.append(db.get(Order, order.id).status)

    assert seen == [
        OrderStatus.PREPARING,
        OrderStatus.OUT_FOR_DELIVERY,
        OrderStatus.DELIVERED,
    ]


def test_stops_at_delivered_and_does_no_further_work(simulator, make_order, db):
    order = make_order()
    for _ in range(3):
        backdate(db, order, STEP_SECONDS + 1)
        simulator.tick()

    backdate(db, order, STEP_SECONDS * 100)

    assert simulator.tick() == 0
    db.expire_all()
    assert db.get(Order, order.id).status is OrderStatus.DELIVERED


def test_never_touches_a_cancelled_order(simulator, make_order, order_service, db):
    order = make_order()
    order_service.cancel_order(order.public_id)
    backdate(db, order, STEP_SECONDS * 100)

    assert simulator.tick() == 0
    db.expire_all()
    assert db.get(Order, order.id).status is OrderStatus.CANCELLED


def test_advances_several_due_orders_in_one_tick(simulator, make_order, db):
    orders = [make_order() for _ in range(3)]
    for order in orders:
        backdate(db, order, STEP_SECONDS + 1)

    assert simulator.tick() == 3


def test_only_advances_the_orders_that_are_actually_due(simulator, make_order, db):
    due = make_order()
    not_due = make_order()
    backdate(db, due, STEP_SECONDS + 1)

    assert simulator.tick() == 1
    db.expire_all()
    assert db.get(Order, due.id).status is OrderStatus.PREPARING
    assert db.get(Order, not_due.id).status is OrderStatus.RECEIVED


def test_a_manual_status_change_resets_the_clock(simulator, make_order, order_service, db):
    """Otherwise a manual bump would be followed immediately by an automatic one."""
    order = make_order()
    backdate(db, order, STEP_SECONDS + 1)
    order_service.update_status(order.public_id, OrderStatus.PREPARING)

    assert simulator.tick() == 0


def test_each_advance_is_announced_to_subscribers(simulator, make_order, db, publisher):
    order = make_order()
    backdate(db, order, STEP_SECONDS + 1)
    publisher.clear()

    simulator.tick()

    assert publisher.types_for(order.public_id) == ["order.status_changed"]
    assert publisher.last_payload["status"] == "Preparing"


def test_progress_survives_a_restart(session_factory, publisher, make_order, db):
    """State lives in the database, so a fresh simulator picks up where the
    previous process left off."""
    order = make_order()
    backdate(db, order, STEP_SECONDS + 1)

    first = StatusSimulator(session_factory, publisher, step_seconds=STEP_SECONDS, tick_seconds=1)
    first.tick()

    backdate(db, order, STEP_SECONDS + 1)
    second = StatusSimulator(session_factory, publisher, step_seconds=STEP_SECONDS, tick_seconds=1)
    second.tick()

    db.expire_all()
    assert db.get(Order, order.id).status is OrderStatus.OUT_FOR_DELIVERY


@pytest.mark.asyncio
async def test_start_and_stop_are_idempotent(simulator):
    await simulator.start()
    await simulator.start()  # second call must not spawn a second task
    assert simulator.is_running

    await simulator.stop()
    await simulator.stop()  # safe to stop twice
    assert not simulator.is_running


@pytest.mark.asyncio
async def test_a_failing_tick_does_not_kill_the_loop(simulator, monkeypatch):
    """One bad tick must not silently end the simulation for the whole process."""
    import asyncio

    calls = {"n": 0}

    def exploding_tick() -> int:
        calls["n"] += 1
        raise RuntimeError("database went away")

    monkeypatch.setattr(simulator, "tick", exploding_tick)

    await simulator.start()

    # Wait for a second tick rather than sleeping a fixed amount: the point is
    # that the loop keeps going after a failure, not how fast it gets there.
    deadline = asyncio.get_running_loop().time() + 5.0
    while calls["n"] < 2 and asyncio.get_running_loop().time() < deadline:
        await asyncio.sleep(0.01)

    still_running = simulator.is_running
    await simulator.stop()

    assert calls["n"] >= 2, "the loop stopped after the first failure"
    assert still_running
