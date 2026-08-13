"""Menu data access."""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import MenuItem


class MenuRepository:
    def __init__(self, db: Session) -> None:
        self._db = db

    def list_items(
        self,
        *,
        category: str | None = None,
        search: str | None = None,
        available_only: bool = True,
    ) -> list[MenuItem]:
        stmt = select(MenuItem)
        if available_only:
            stmt = stmt.where(MenuItem.is_available.is_(True))
        if category:
            stmt = stmt.where(MenuItem.category == category)
        if search:
            # Parameterised LIKE -- the value is bound, never interpolated.
            pattern = f"%{search.strip()}%"
            stmt = stmt.where(MenuItem.name.ilike(pattern))
        stmt = stmt.order_by(MenuItem.category, MenuItem.name)
        return list(self._db.scalars(stmt))

    def list_categories(self) -> list[str]:
        stmt = (
            select(MenuItem.category)
            .where(MenuItem.is_available.is_(True))
            .distinct()
            .order_by(MenuItem.category)
        )
        return list(self._db.scalars(stmt))

    def get(self, item_id: int) -> MenuItem | None:
        return self._db.get(MenuItem, item_id)

    def get_available_by_ids(self, item_ids: list[int]) -> dict[int, MenuItem]:
        """Fetch several items at once, keyed by id.

        Batched deliberately: resolving a cart one query per line is the
        classic N+1 that makes checkout slow as carts grow.
        """
        if not item_ids:
            return {}
        stmt = select(MenuItem).where(
            MenuItem.id.in_(item_ids),
            MenuItem.is_available.is_(True),
        )
        return {item.id: item for item in self._db.scalars(stmt)}

    def count(self) -> int:
        return self._db.scalar(select(func.count()).select_from(MenuItem)) or 0

    def bulk_create(self, items: list[MenuItem]) -> None:
        self._db.add_all(items)
        self._db.commit()
