"""Menu seed data.

Images are hotlinked from Unsplash's CDN so the repo stays small and there is
no asset pipeline to run. The frontend degrades to a placeholder tile if an
image fails to load.
"""

from __future__ import annotations

import logging

from sqlalchemy.orm import Session

from app.models import MenuItem
from app.repositories import MenuRepository

logger = logging.getLogger(__name__)

_IMG = "https://images.unsplash.com/photo-{id}?auto=format&fit=crop&w=800&q=70"

MENU_SEED: list[dict] = [
    {
        "name": "Margherita Pizza",
        "description": "Hand-stretched sourdough base, San Marzano tomato, fior di latte and torn basil.",
        "price_cents": 1150,
        "category": "Pizza",
        "image_url": _IMG.format(id="1604382354936-07c5d9983bd3"),
    },
    {
        "name": "Diavola Pizza",
        "description": "Spicy salami, chilli honey drizzle, mozzarella and oregano on a charred crust.",
        "price_cents": 1395,
        "category": "Pizza",
        "image_url": _IMG.format(id="1628840042765-356cda07504e"),
    },
    {
        "name": "Truffle Mushroom Pizza",
        "description": "Wild mushrooms, taleggio, black truffle paste and rocket, finished with parmesan.",
        "price_cents": 1590,
        "category": "Pizza",
        "image_url": _IMG.format(id="1513104890138-7c749659a591"),
    },
    {
        "name": "Classic Cheeseburger",
        "description": "Aged beef patty, melted cheddar, pickles, house burger sauce in a brioche bun.",
        "price_cents": 1090,
        "category": "Burgers",
        "image_url": _IMG.format(id="1568901346375-23c9450c58cd"),
    },
    {
        "name": "Crispy Chicken Burger",
        "description": "Buttermilk-brined thigh, buttermilk slaw, sriracha mayo and dill pickles.",
        "price_cents": 1150,
        "category": "Burgers",
        "image_url": _IMG.format(id="1606755962773-d324e0a13086"),
    },
    {
        "name": "Beyond Veggie Burger",
        "description": "Plant-based patty, smoked vegan gouda, caramelised onion and tomato relish.",
        "price_cents": 1250,
        "category": "Burgers",
        "image_url": _IMG.format(id="1520072959219-c595dc870360"),
    },
    {
        "name": "Chicken Pad Thai",
        "description": "Rice noodles wok-tossed with tamarind, egg, beansprouts, peanuts and lime.",
        "price_cents": 1340,
        "category": "Asian",
        "image_url": _IMG.format(id="1559314809-0d155014e29e"),
    },
    {
        "name": "Salmon Poke Bowl",
        "description": "Sushi rice, cured salmon, edamame, avocado, pickled ginger and sesame dressing.",
        "price_cents": 1480,
        "category": "Asian",
        "image_url": _IMG.format(id="1546069901-ba9599a7e63c"),
    },
    {
        "name": "Butter Chicken",
        "description": "Tandoori chicken in a fenugreek tomato cream sauce, served with basmati rice.",
        "price_cents": 1420,
        "category": "Asian",
        "image_url": _IMG.format(id="1565557623262-b51c2513a641"),
    },
    {
        "name": "Loaded Fries",
        "description": "Triple-cooked fries with smoked cheese sauce, jalapenos and crispy shallots.",
        "price_cents": 590,
        "category": "Sides",
        "image_url": _IMG.format(id="1573080496219-bb080dd4f877"),
    },
    {
        "name": "Garlic Focaccia",
        "description": "Warm rosemary focaccia with confit garlic butter and flaky sea salt.",
        "price_cents": 490,
        "category": "Sides",
        "image_url": _IMG.format(id="1600555379765-f82335a7b1b0"),
    },
    {
        "name": "Buffalo Wings",
        "description": "Six free-range wings tossed in Frank's hot sauce with a blue cheese dip.",
        "price_cents": 780,
        "category": "Sides",
        "image_url": _IMG.format(id="1608039755401-742074f0548d"),
    },
    {
        "name": "Molten Chocolate Cake",
        "description": "Dark Valrhona sponge with a liquid centre and salted caramel gelato.",
        "price_cents": 690,
        "category": "Desserts",
        "image_url": _IMG.format(id="1624353365286-3f8d62daad51"),
    },
    {
        "name": "Tiramisu",
        "description": "Espresso-soaked savoiardi, mascarpone cream and a dusting of cocoa.",
        "price_cents": 640,
        "category": "Desserts",
        "image_url": _IMG.format(id="1571877227200-a0d98ea607e9"),
    },
    {
        "name": "Fresh Lemonade",
        "description": "Cold-pressed lemons, cane sugar and mint over crushed ice.",
        "price_cents": 350,
        "category": "Drinks",
        "image_url": _IMG.format(id="1523677011781-c91d1bbe2f9e"),
    },
    {
        "name": "Craft Cola",
        "description": "Small-batch cola with citrus peel and vanilla, served chilled.",
        "price_cents": 290,
        "category": "Drinks",
        "image_url": _IMG.format(id="1622483767028-3f66f32aef97"),
    },
]


def seed_menu(db: Session, *, force: bool = False) -> int:
    """Insert the seed menu if the table is empty.

    Idempotent by default so it is safe to call on every boot.
    """
    repository = MenuRepository(db)
    existing = repository.count()
    if existing and not force:
        logger.debug("menu already seeded (%d items)", existing)
        return 0

    items = [MenuItem(**row) for row in MENU_SEED]
    repository.bulk_create(items)
    logger.info("seeded %d menu items", len(items))
    return len(items)
