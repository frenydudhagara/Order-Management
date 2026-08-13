"""Menu endpoints."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query

from app.api.deps import MenuServiceDep
from app.schemas import MenuItemRead

router = APIRouter(prefix="/menu", tags=["menu"])


@router.get("", response_model=list[MenuItemRead], summary="List menu items")
def list_menu(
    service: MenuServiceDep,
    category: Annotated[str | None, Query(max_length=60)] = None,
    search: Annotated[str | None, Query(max_length=80)] = None,
) -> list[MenuItemRead]:
    """Return the available menu, optionally filtered by category or name."""
    items = service.list_items(category=category, search=search)
    return [MenuItemRead.model_validate(item) for item in items]


@router.get("/categories", response_model=list[str], summary="List menu categories")
def list_categories(service: MenuServiceDep) -> list[str]:
    return service.list_categories()
