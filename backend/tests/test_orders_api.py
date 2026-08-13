"""Order CRUD over HTTP."""

from __future__ import annotations

import uuid

from app.services.pricing import DELIVERY_FEE_CENTS


# -- create --------------------------------------------------------------


def test_places_an_order_and_returns_it(client, make_order_payload, seeded_menu):
    payload = make_order_payload(
        items=[{"menu_item_id": seeded_menu[0].id, "quantity": 2}]
    )

    response = client.post("/api/orders", json=payload)

    assert response.status_code == 201
    order = response.json()
    assert order["status"] == "Order Received"
    assert order["customer_name"] == payload["customer_name"]
    assert order["address"] == payload["address"]
    assert len(order["items"]) == 1
    assert order["items"][0]["quantity"] == 2


def test_order_id_is_an_unguessable_uuid_not_a_sequence(client, make_order_payload):
    """Sequential ids would let anyone enumerate other customers' addresses."""
    first = client.post("/api/orders", json=make_order_payload()).json()
    second = client.post("/api/orders", json=make_order_payload()).json()

    uuid.UUID(first["id"])  # raises if not a UUID
    assert first["id"] != second["id"]


def test_totals_are_computed_from_the_menu(client, make_order_payload, seeded_menu):
    item = seeded_menu[0]
    payload = make_order_payload(items=[{"menu_item_id": item.id, "quantity": 2}])

    order = client.post("/api/orders", json=payload).json()

    expected_subtotal = item.price_cents * 2
    assert order["subtotal_cents"] == expected_subtotal
    assert order["total_cents"] == expected_subtotal + order["delivery_fee_cents"]
    assert order["items"][0]["line_total_cents"] == expected_subtotal


def test_client_supplied_prices_are_ignored(client, make_order_payload, seeded_menu):
    """A tampered payload must not be able to set its own price."""
    item = seeded_menu[0]
    payload = make_order_payload(items=[{"menu_item_id": item.id, "quantity": 1}])
    payload["items"][0]["unit_price_cents"] = 1
    payload["total_cents"] = 1

    response = client.post("/api/orders", json=payload)

    # extra="forbid" rejects the unknown fields outright rather than silently
    # dropping them, so the client learns its payload was wrong.
    assert response.status_code == 422


def test_delivery_fee_is_charged_on_small_orders(client, make_order_payload, seeded_menu):
    cheapest = min(seeded_menu, key=lambda item: item.price_cents)
    payload = make_order_payload(items=[{"menu_item_id": cheapest.id, "quantity": 1}])

    order = client.post("/api/orders", json=payload).json()

    assert order["subtotal_cents"] < 2500
    assert order["delivery_fee_cents"] == DELIVERY_FEE_CENTS


def test_delivery_is_free_above_the_threshold(client, make_order_payload, seeded_menu):
    priciest = max(seeded_menu, key=lambda item: item.price_cents)
    payload = make_order_payload(items=[{"menu_item_id": priciest.id, "quantity": 4}])

    order = client.post("/api/orders", json=payload).json()

    assert order["subtotal_cents"] >= 2500
    assert order["delivery_fee_cents"] == 0
    assert order["total_cents"] == order["subtotal_cents"]


def test_line_items_snapshot_name_and_price(client, make_order_payload, seeded_menu, db):
    """Later menu edits must not rewrite the history of a placed order."""
    from app.models import MenuItem

    item = seeded_menu[0]
    order = client.post(
        "/api/orders",
        json=make_order_payload(items=[{"menu_item_id": item.id, "quantity": 1}]),
    ).json()
    original_name = order["items"][0]["name"]
    original_price = order["items"][0]["unit_price_cents"]

    menu_row = db.get(MenuItem, item.id)
    menu_row.name = "Renamed Dish"
    menu_row.price_cents = 9999
    db.commit()

    refetched = client.get(f"/api/orders/{order['id']}").json()

    assert refetched["items"][0]["name"] == original_name
    assert refetched["items"][0]["unit_price_cents"] == original_price
    assert refetched["total_cents"] == order["total_cents"]


def test_rejects_order_for_a_menu_item_that_does_not_exist(client, make_order_payload):
    payload = make_order_payload(items=[{"menu_item_id": 999_999, "quantity": 1}])

    response = client.post("/api/orders", json=payload)

    assert response.status_code == 404
    body = response.json()
    assert body["error"]["code"] == "menu_item_not_found"
    assert body["error"]["details"]["menu_item_ids"] == [999_999]


def test_rejects_order_for_an_unavailable_item(client, make_order_payload, seeded_menu, db):
    from app.models import MenuItem

    item = db.get(MenuItem, seeded_menu[0].id)
    item.is_available = False
    db.commit()

    response = client.post(
        "/api/orders",
        json=make_order_payload(items=[{"menu_item_id": item.id, "quantity": 1}]),
    )

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "menu_item_not_found"


def test_records_an_initial_status_event(client, placed_order):
    assert [event["status"] for event in placed_order["events"]] == ["Order Received"]
    assert placed_order["events"][0]["note"]


def test_timestamps_are_serialised_as_utc(client, placed_order):
    """Without an explicit offset the browser would read these as local time."""
    assert placed_order["created_at"].endswith("Z")
    assert placed_order["updated_at"].endswith("Z")


def test_exposes_the_next_expected_status(client, placed_order):
    assert placed_order["next_status"] == "Preparing"


# -- read ----------------------------------------------------------------


def test_reads_a_single_order(client, placed_order):
    response = client.get(f"/api/orders/{placed_order['id']}")

    assert response.status_code == 200
    assert response.json()["id"] == placed_order["id"]


def test_unknown_order_returns_404_with_a_typed_code(client):
    response = client.get(f"/api/orders/{uuid.uuid4()}")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "order_not_found"


def test_malformed_order_id_is_rejected_before_hitting_the_database(client):
    response = client.get("/api/orders/1")

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


def test_lists_recent_orders_newest_first(client, make_order_payload):
    ids = [client.post("/api/orders", json=make_order_payload()).json()["id"] for _ in range(3)]

    summaries = client.get("/api/orders").json()

    assert [entry["id"] for entry in summaries] == list(reversed(ids))


def test_lists_only_the_requested_order_ids(client, make_order_payload):
    wanted = client.post("/api/orders", json=make_order_payload()).json()["id"]
    client.post("/api/orders", json=make_order_payload())

    summaries = client.get("/api/orders", params={"ids": wanted}).json()

    assert [entry["id"] for entry in summaries] == [wanted]


def test_unknown_ids_in_the_filter_are_skipped_silently(client, make_order_payload):
    known = client.post("/api/orders", json=make_order_payload()).json()["id"]

    summaries = client.get("/api/orders", params={"ids": f"{known},{uuid.uuid4()}"}).json()

    assert [entry["id"] for entry in summaries] == [known]


def test_summary_counts_units_not_lines(client, make_order_payload, seeded_menu):
    payload = make_order_payload(
        items=[
            {"menu_item_id": seeded_menu[0].id, "quantity": 2},
            {"menu_item_id": seeded_menu[1].id, "quantity": 3},
        ]
    )
    order_id = client.post("/api/orders", json=payload).json()["id"]

    summary = client.get("/api/orders", params={"ids": order_id}).json()[0]

    assert summary["item_count"] == 5


def test_pagination_limits_results(client, make_order_payload):
    for _ in range(3):
        client.post("/api/orders", json=make_order_payload())

    assert len(client.get("/api/orders", params={"limit": 2}).json()) == 2
    assert len(client.get("/api/orders", params={"limit": 2, "offset": 2}).json()) == 1


def test_rejects_out_of_range_pagination(client):
    assert client.get("/api/orders", params={"limit": 0}).status_code == 422
    assert client.get("/api/orders", params={"limit": 500}).status_code == 422
    assert client.get("/api/orders", params={"offset": -1}).status_code == 422


# -- update --------------------------------------------------------------


def test_updates_order_status(client, placed_order):
    response = client.patch(
        f"/api/orders/{placed_order['id']}/status",
        json={"status": "Preparing"},
    )

    assert response.status_code == 200
    assert response.json()["status"] == "Preparing"


def test_status_update_appends_to_the_event_timeline(client, placed_order):
    client.patch(f"/api/orders/{placed_order['id']}/status", json={"status": "Preparing"})

    order = client.get(f"/api/orders/{placed_order['id']}").json()

    assert [event["status"] for event in order["events"]] == ["Order Received", "Preparing"]


def test_status_update_accepts_a_custom_note(client, placed_order):
    client.patch(
        f"/api/orders/{placed_order['id']}/status",
        json={"status": "Preparing", "note": "Chef started the dough."},
    )

    order = client.get(f"/api/orders/{placed_order['id']}").json()

    assert order["events"][-1]["note"] == "Chef started the dough."


def test_status_update_on_unknown_order_is_404(client):
    response = client.patch(
        f"/api/orders/{uuid.uuid4()}/status",
        json={"status": "Preparing"},
    )

    assert response.status_code == 404


def test_rejects_a_status_outside_the_vocabulary(client, placed_order):
    response = client.patch(
        f"/api/orders/{placed_order['id']}/status",
        json={"status": "Abducted by aliens"},
    )

    assert response.status_code == 422


# -- delete (cancel) -----------------------------------------------------


def test_cancelling_an_order_is_a_soft_delete(client, placed_order):
    response = client.delete(f"/api/orders/{placed_order['id']}")

    assert response.status_code == 200
    assert response.json()["status"] == "Cancelled"
    # The record survives so the kitchen keeps its history.
    assert client.get(f"/api/orders/{placed_order['id']}").status_code == 200


def test_cannot_cancel_once_out_for_delivery(client, placed_order):
    order_id = placed_order["id"]
    client.patch(f"/api/orders/{order_id}/status", json={"status": "Preparing"})
    client.patch(f"/api/orders/{order_id}/status", json={"status": "Out for Delivery"})

    response = client.delete(f"/api/orders/{order_id}")

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "order_not_cancellable"


def test_cancelling_twice_is_a_conflict_not_a_crash(client, placed_order):
    client.delete(f"/api/orders/{placed_order['id']}")

    response = client.delete(f"/api/orders/{placed_order['id']}")

    assert response.status_code == 409


def test_cancelling_an_unknown_order_is_404(client):
    assert client.delete(f"/api/orders/{uuid.uuid4()}").status_code == 404


# -- misc ----------------------------------------------------------------


def test_exposes_the_status_vocabulary(client):
    statuses = client.get("/api/orders/meta/statuses").json()

    assert statuses == [
        "Order Received",
        "Preparing",
        "Out for Delivery",
        "Delivered",
        "Cancelled",
    ]


def test_health_reports_database_connectivity(client):
    body = client.get("/api/health").json()

    assert body["status"] == "ok"
    assert body["database"] == "ok"
