"""Application factory and lifespan wiring."""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from collections.abc import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.api.routes import api_router
from app.config import settings
from app.database import init_db, session_scope
from app.errors import register_exception_handlers
from app.middleware import BodySizeLimitMiddleware, SecurityHeadersMiddleware
from app.realtime import manager
from app.seed import seed_menu
from app.services.status_simulator import StatusSimulator

logging.basicConfig(
    level=logging.DEBUG if settings.debug else logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

API_PREFIX = "/api"


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Prepare the database, then run the status simulator for the app's life."""
    init_db()
    with session_scope() as db:
        seed_menu(db)

    # Worker threads need a handle on the serving loop to push WebSocket
    # messages, and it only exists once the app is actually running.
    manager.bind_loop(asyncio.get_running_loop())

    simulator = StatusSimulator(
        session_scope,
        manager,
        step_seconds=settings.status_step_seconds,
        tick_seconds=settings.simulator_tick_seconds,
    )
    app.state.simulator = simulator

    if settings.enable_status_simulator:
        await simulator.start()

    try:
        yield
    finally:
        await simulator.stop()
        await manager.close_all()


def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.app_name,
        version=__version__,
        summary="Order management for a food delivery app: menu, checkout and live order status.",
        lifespan=lifespan,
        docs_url="/docs",
        redoc_url="/redoc",
    )

    # Order matters: CORS must be added last so it wraps everything and can
    # still attach headers to error responses produced further in.
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(BodySizeLimitMiddleware, max_bytes=64 * 1024)
    app.add_middleware(
        CORSMiddleware,
        # An explicit allowlist, never "*". Wildcards cannot be combined with
        # credentials and would let any site call this API from a browser.
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type"],
        max_age=600,
    )

    register_exception_handlers(app)
    app.include_router(api_router, prefix=API_PREFIX)

    @app.get("/", include_in_schema=False)
    def root() -> dict:
        return {
            "name": settings.app_name,
            "version": __version__,
            "docs": "/docs",
            "api": API_PREFIX,
        }

    logger.info("app ready (env=%s, cors=%s)", settings.environment, settings.cors_origins)
    return app


app = create_app()
