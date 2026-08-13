"""Menu read operations."""

from __future__ import annotations

from app.models import MenuItem
from app.repositories import MenuRepository


class MenuService:
    def __init__(self, repository: MenuRepository) -> None:
        self._repository = repository

    def list_items(
        self,
        *,
        category: str | None = None,
        search: str | None = None,
        include_unavailable: bool = False,
    ) -> list[MenuItem]:
        return self._repository.list_items(
            category=category,
            search=search,
            available_only=not include_unavailable,
        )

    def list_categories(self) -> list[str]:
        return self._repository.list_categories()
