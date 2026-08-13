"""Menu retrieval."""

from __future__ import annotations

from app.models import MenuItem


def test_lists_menu_items_with_all_display_fields(client):
    response = client.get("/api/menu")

    assert response.status_code == 200
    items = response.json()
    assert len(items) > 0

    # The brief requires name, description, price and image on every item.
    for item in items:
        assert item["name"]
        assert item["description"]
        assert item["price_cents"] > 0
        assert item["image_url"].startswith("https://")


def test_price_is_exposed_both_as_cents_and_decimal(client):
    item = next(i for i in client.get("/api/menu").json() if i["price_cents"] == 1150)

    assert item["price"] == 11.50


def test_menu_is_sorted_by_category_then_name(client):
    items = client.get("/api/menu").json()

    keys = [(item["category"], item["name"]) for item in items]
    assert keys == sorted(keys)


def test_filters_by_category(client):
    items = client.get("/api/menu", params={"category": "Pizza"}).json()

    assert len(items) > 0
    assert {item["category"] for item in items} == {"Pizza"}


def test_unknown_category_returns_empty_list_not_an_error(client):
    response = client.get("/api/menu", params={"category": "Sushi Omakase"})

    assert response.status_code == 200
    assert response.json() == []


def test_search_matches_partial_name_case_insensitively(client):
    items = client.get("/api/menu", params={"search": "PIZZA"}).json()

    assert len(items) >= 3
    assert all("pizza" in item["name"].lower() for item in items)


def test_search_value_with_sql_metacharacters_is_treated_as_literal_text(client):
    """A quote in the query must be bound as data, never concatenated into SQL."""
    response = client.get("/api/menu", params={"search": "'; DROP TABLE menu_items; --"})

    assert response.status_code == 200
    assert response.json() == []
    # The table is still there afterwards.
    assert len(client.get("/api/menu").json()) > 0


def test_unavailable_items_are_hidden_from_the_menu(client, db):
    item = db.query(MenuItem).filter(MenuItem.name == "Tiramisu").one()
    item.is_available = False
    db.commit()

    names = [entry["name"] for entry in client.get("/api/menu").json()]

    assert "Tiramisu" not in names


def test_lists_categories(client):
    categories = client.get("/api/menu/categories").json()

    assert categories == sorted(categories)
    assert "Pizza" in categories
    assert len(set(categories)) == len(categories)


def test_overlong_search_term_is_rejected(client):
    response = client.get("/api/menu", params={"search": "x" * 200})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"
