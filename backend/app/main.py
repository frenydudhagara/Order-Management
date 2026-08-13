"""Application factory and lifespan wiring."""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from collections.abc import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.engine import make_url
from sqlalchemy.exc import SQLAlchemyError

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


def _prepare_database() -> None:
    """Create the schema and seed the menu, failing loudly and legibly.

    This is the first thing that touches the database, so it is where a bad
    DATABASE_URL surfaces -- during startup, which means the whole deploy
    fails. Failing fast is right, but a bare SQLAlchemy traceback in a hosting
    platform's log viewer does not say which of the handful of likely causes
    it was, so the diagnosis is spelled out before re-raising.
    """
    try:
        init_db()
        with session_scope() as db:
            seed_menu(db)
    except SQLAlchemyError as exc:
        safe_url = make_url(settings.database_url).render_as_string(hide_password=True)
        logger.error(
            "Could not reach the database at %s\n"
            "  %s: %s\n"
            "Usual causes:\n"
            "  * the password still has [square brackets] around it -- they are\n"
            "    the dashboard's placeholder markers, not part of the value\n"
            "  * a special character in the password is not percent-encoded\n"
            "    (@ -> %%40, # -> %%23)\n"
            "  * the host is Supabase's IPv6-only direct connection\n"
            "    (db.<ref>.supabase.co) rather than the session pooler\n"
            "  * the database is paused or asleep\n"
            "Run `python check_db.py` locally with the same URL to confirm.",
            safe_url,
            type(exc).__name__,
            str(exc).strip().splitlines()[0],
        )
        raise


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Prepare the database, then run the status simulator for the app's life."""
    _prepare_database()

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
