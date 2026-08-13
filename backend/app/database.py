"""Database engine, session factory and declarative base."""

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings

# Supabase's Supavisor pooler listens on 6543 in *transaction* mode, where each
# transaction may land on a different backend connection.
TRANSACTION_POOLER_PORT = 6543


class Base(DeclarativeBase):
    """Declarative base shared by every ORM model."""


def uses_transaction_pooler(database_url: str) -> bool:
    """True when the URL points at a transaction-mode connection pooler.

    Only the port is inspected, because that is what distinguishes Supabase's
    two pooler modes (5432 session, 6543 transaction) on the same hostname.
    """
    try:
        return make_url(database_url).port == TRANSACTION_POOLER_PORT
    except Exception:  # noqa: BLE001 - a malformed URL fails later, with a better message
        return False


def _engine_kwargs(database_url: str) -> dict:
    # SQLite defaults to rejecting cross-thread use, but FastAPI serves
    # requests from a thread pool, so that check has to be relaxed.
    if database_url.startswith("sqlite"):
        return {"connect_args": {"check_same_thread": False}}

    # Postgres. Managed free tiers sleep and cap connections, so the pool is
    # kept small and connections are treated as disposable: `pool_pre_ping`
    # discards one the server has already dropped instead of failing the
    # request, and `pool_recycle` retires connections before an idle timeout
    # can do it for us.
    kwargs: dict = {
        "pool_pre_ping": True,
        "pool_recycle": 300,
        "pool_size": 5,
        "max_overflow": 5,
    }

    if uses_transaction_pooler(database_url):
        # psycopg 3 silently starts server-side preparing a query after it has
        # been executed a few times. Through a transaction-mode pooler the next
        # execution can arrive on a different backend, which has never seen
        # that statement -- so a request that worked all morning suddenly fails
        # with "prepared statement does not exist". Disabling the optimisation
        # is the supported fix.
        kwargs["connect_args"] = {"prepare_threshold": None}

    return kwargs


engine = create_engine(
    settings.database_url,
    echo=False,
    **_engine_kwargs(settings.database_url),
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Iterator[Session]:
    """FastAPI dependency yielding a request-scoped session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@contextmanager
def session_scope() -> Iterator[Session]:
    """Session for work that happens outside a request.

    WebSocket handlers and the background simulator outlive any single
    request, so they open a short-lived session per unit of work instead of
    holding a request-scoped one. `SessionLocal` is looked up at call time,
    which is what lets the test suite point this at an isolated database.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    """Create tables for any model that has been imported."""
    # Imported for the side effect of registering models on Base.metadata.
    from app import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
