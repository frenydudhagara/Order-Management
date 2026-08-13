"""Input validation and edge cases on the checkout payload."""

from __future__ import annotations

import pytest


def _post(client, payload):
    return client.post("/api/orders", json=payload)


def _field_errors(response) -> dict[str, str]:
    return response.json()["error"]["details"]["fields"]


# -- required fields -----------------------------------------------------


@pytest.mark.parametrize(
    "missing_field",
    ["customer_name", "phone", "address", "items"],
)
def test_every_required_field_is_enforced(client, make_order_payload, missing_field):
    payload = make_order_payload()
    del payload[missing_field]

    response = _post(client, payload)

    assert response.status_code == 422
    assert missing_field in _field_errors(response)


def test_notes_are_optional(client, make_order_payload):
    payload = make_order_payload()
    del payload["notes"]

    response = _post(client, payload)

    assert response.status_code == 201
    assert response.json()["notes"] == ""


def test_errors_are_keyed_by_field_so_the_form_can_show_them_inline(
    client, make_order_payload
):
    payload = make_order_payload(customer_name="", phone="abc", address="short")

    fields = _field_errors(_post(client, payload))

    assert {"customer_name", "phone", "address"} <= set(fields)
    assert all(isinstance(message, str) and message for message in fields.values())


# -- name ----------------------------------------------------------------


@pytest.mark.parametrize("name", ["", " ", "A", "  x  "])
def test_rejects_a_name_that_is_too_short(client, make_order_payload, name):
    assert _post(client, make_order_payload(customer_name=name)).status_code == 422


def test_rejects_a_name_with_no_letters(client, make_order_payload):
    response = _post(client, make_order_payload(customer_name="12345"))

    assert response.status_code == 422
    assert "letter" in _field_errors(response)["customer_name"].lower()


def test_rejects_an_overlong_name(client, make_order_payload):
    assert _post(client, make_order_payload(customer_name="a" * 121)).status_code == 422


def test_trims_surrounding_whitespace(client, make_order_payload):
    order = _post(client, make_order_payload(customer_name="  Aditi Rao  ")).json()

    assert order["customer_name"] == "Aditi Rao"


def test_strips_control_characters_from_text_fields(client, make_order_payload):
    """Null bytes and escape sequences have no place in a delivery address."""
    order = _post(
        client,
        make_order_payload(customer_name="Nia\x00 Wong\x1b[31m"),
    ).json()

    assert order["customer_name"] == "Nia Wong[31m"


def test_accepts_names_with_accents_and_apostrophes(client, make_order_payload):
    response = _post(client, make_order_payload(customer_name="Zoë O'Brien-Müller"))

    assert response.status_code == 201


def test_stores_markup_verbatim_without_interpreting_it(client, make_order_payload):
    """The API is not an HTML renderer: it must neither execute nor mangle
    markup. React escapes it on output, so round-tripping it unchanged is
    correct behaviour."""
    hostile = "<script>alert('xss')</script>"

    order = _post(client, make_order_payload(notes=hostile)).json()

    assert order["notes"] == hostile


# -- phone ---------------------------------------------------------------


@pytest.mark.parametrize(
    "phone",
    [
        "+44 20 7946 0958",
        "020 7946 0958",
        "(415) 555-0134",
        "+1-415-555-0134",
        "9876543210",
    ],
)
def test_accepts_realistic_phone_formats(client, make_order_payload, phone):
    assert _post(client, make_order_payload(phone=phone)).status_code == 201


@pytest.mark.parametrize(
    "phone",
    [
        "call me maybe",  # no digits
        "12345",  # too few digits
        "1" * 16,  # too many digits
        "+44 7946 0958 ext. 12",  # letters
        "++4479460958",  # malformed prefix
    ],
)
def test_rejects_implausible_phone_numbers(client, make_order_payload, phone):
    response = _post(client, make_order_payload(phone=phone))

    assert response.status_code == 422
    assert "phone" in _field_errors(response)


# -- address -------------------------------------------------------------


def test_rejects_an_address_that_is_too_short_to_deliver_to(client, make_order_payload):
    assert _post(client, make_order_payload(address="Flat 2")).status_code == 422


def test_rejects_an_overlong_address(client, make_order_payload):
    assert _post(client, make_order_payload(address="x" * 501)).status_code == 422


def test_rejects_overlong_notes(client, make_order_payload):
    assert _post(client, make_order_payload(notes="x" * 501)).status_code == 422


# -- items ---------------------------------------------------------------


def test_rejects_an_empty_cart(client, make_order_payload):
    response = _post(client, make_order_payload(items=[]))

    assert response.status_code == 422
    assert "items" in _field_errors(response)


@pytest.mark.parametrize("quantity", [0, -1, -100])
def test_rejects_a_non_positive_quantity(client, make_order_payload, seeded_menu, quantity):
    payload = make_order_payload(
        items=[{"menu_item_id": seeded_menu[0].id, "quantity": quantity}]
    )

    assert _post(client, payload).status_code == 422


def test_rejects_an_absurd_quantity(client, make_order_payload, seeded_menu):
    """An unbounded quantity is both a nonsense order and a memory risk."""
    payload = make_order_payload(
        items=[{"menu_item_id": seeded_menu[0].id, "quantity": 10_000}]
    )

    assert _post(client, payload).status_code == 422


def test_accepts_the_maximum_allowed_quantity(client, make_order_payload, seeded_menu):
    from app.config import settings

    payload = make_order_payload(
        items=[
            {"menu_item_id": seeded_menu[0].id, "quantity": settings.max_quantity_per_item}
        ]
    )

    assert _post(client, payload).status_code == 201


def test_rejects_a_fractional_quantity(client, make_order_payload, seeded_menu):
    payload = make_order_payload(
        items=[{"menu_item_id": seeded_menu[0].id, "quantity": 1.5}]
    )

    assert _post(client, payload).status_code == 422


def test_rejects_too_many_distinct_lines(client, make_order_payload):
    payload = make_order_payload(
        items=[{"menu_item_id": i, "quantity": 1} for i in range(1, 60)]
    )

    assert _post(client, payload).status_code == 422


def test_rejects_duplicate_lines_for_the_same_dish(client, make_order_payload, seeded_menu):
    """Two lines for one dish is ambiguous; the client must merge them."""
    item_id = seeded_menu[0].id
    payload = make_order_payload(
        items=[
            {"menu_item_id": item_id, "quantity": 1},
            {"menu_item_id": item_id, "quantity": 2},
        ]
    )

    response = _post(client, payload)

    assert response.status_code == 422
    assert "duplicate" in str(_field_errors(response)).lower()


def test_rejects_a_non_positive_menu_item_id(client, make_order_payload):
    payload = make_order_payload(items=[{"menu_item_id": 0, "quantity": 1}])

    assert _post(client, payload).status_code == 422


def test_rejects_unknown_fields_rather_than_ignoring_them(client, make_order_payload):
    payload = make_order_payload()
    payload["is_admin"] = True

    assert _post(client, payload).status_code == 422


def test_rejects_a_body_that_is_not_an_object(client):
    assert client.post("/api/orders", json=["nope"]).status_code == 422


def test_rejects_an_oversized_body_before_parsing_it(client, make_order_payload):
    payload = make_order_payload(notes="x" * 100_000)

    response = client.post("/api/orders", json=payload)

    assert response.status_code == 413
    assert response.json()["error"]["code"] == "payload_too_large"
