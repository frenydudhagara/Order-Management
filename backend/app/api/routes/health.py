"""Liveness endpoint, used by the host's health checks and the frontend banner."""

from fastapi import APIRouter
from sqlalchemy import text

from app.api.deps import DbSession
from app.config import settings

router = APIRouter(tags=["health"])


@router.get("/health", summary="Service health")
def health(db: DbSession) -> dict:
    """Report process health plus whether the database is actually reachable."""
    try:
        db.execute(text("SELECT 1"))
        database_ok = True
    except Exception:  # noqa: BLE001 - the endpoint must answer even when the DB is down
        database_ok = False

    return {
        "status": "ok" if database_ok else "degraded",
        "environment": settings.environment,
        "database": "ok" if database_ok else "unreachable",
    }
