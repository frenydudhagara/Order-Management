"""Route modules, assembled into a single versioned router."""

from fastapi import APIRouter

from app.api.routes import health, menu, orders, websocket

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(menu.router)
api_router.include_router(orders.router)
api_router.include_router(websocket.router)

__all__ = ["api_router"]
