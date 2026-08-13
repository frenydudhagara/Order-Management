"""FastAPI dependencies.

Wiring lives here so route handlers stay declarative and tests can override a
single provider to swap in a double.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.realtime import manager
from app.realtime.connection_manager import OrderEventPublisher
from app.repositories import MenuRepository, OrderRepository
from app.services import MenuService, OrderService

DbSession = Annotated[Session, Depends(get_db)]


def get_publisher() -> OrderEventPublisher:
    """The realtime publisher. Overridden in tests with a recording double."""
    return manager


def get_menu_service(db: DbSession) -> MenuService:
    return MenuService(MenuRepository(db))


def get_order_service(
    db: DbSession,
    publisher: Annotated[OrderEventPublisher, Depends(get_publisher)],
) -> OrderService:
    return OrderService(OrderRepository(db), MenuRepository(db), publisher)


MenuServiceDep = Annotated[MenuService, Depends(get_menu_service)]
OrderServiceDep = Annotated[OrderService, Depends(get_order_service)]
