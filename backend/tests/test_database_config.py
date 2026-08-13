"""Engine wiring and Postgres compatibility.

Local development and CI run on SQLite, so nothing else in the suite exercises
the production database path. These tests close that gap without needing a
server: `create_engine` does not connect, so it still proves the URL parses and
the driver imports, and the DDL can be compiled against the Postgres dialect to
prove the models translate.
"""

from __future__ import annotations

from sqlalchemy import create_engine
from sqlalchemy.dialects import postgresql
from sqlalchemy.schema import CreateTable

from app import models  # noqa: F401 - registers tables on Base.metadata
from app.config import normalise_database_url
from app.database import Base, _engine_kwargs, uses_transaction_pooler

# Supabase session pooler: one backend connection held for the session, which
# is what a long-running server with its own pool wants.
PRODUCTION_URL = normalise_database_url(
    "postgres://postgres.abcdefgh:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres"
)

# Supabase transaction pooler: same host, different port, different semantics.
TRANSACTION_POOLER_URL = normalise_database_url(
    "postgres://postgres.abcdefgh:pw@aws-0-eu-central-1.pooler.supabase.com:6543/postgres"
)


def postgres_ddl(table_name: str) -> str:
    table = Base.metadata.tables[table_name]
    return str(CreateTable(table).compile(dialect=postgresql.dialect()))


class TestEngineConfiguration:
    def test_a_production_url_resolves_to_the_installed_driver(self):
        """Fails loudly here rather than at container start if psycopg is missing."""
        engine = create_engine(PRODUCTION_URL, **_engine_kwargs(PRODUCTION_URL))

        assert engine.dialect.name == "postgresql"
        assert engine.dialect.driver == "psycopg"

    def test_postgres_connections_are_treated_as_disposable(self):
        """Managed free tiers scale to zero and drop idle connections."""
        engine = create_engine(PRODUCTION_URL, **_engine_kwargs(PRODUCTION_URL))

        assert engine.pool._pre_ping is True
        assert engine.pool._recycle == 300

    def test_the_postgres_pool_stays_small(self):
        """Free tiers cap total connections; an unbounded pool exhausts them."""
        kwargs = _engine_kwargs(PRODUCTION_URL)

        assert kwargs["pool_size"] <= 5
        assert kwargs["max_overflow"] <= 5

    def test_sqlite_allows_cross_thread_use(self):
        """FastAPI serves sync handlers from a thread pool."""
        kwargs = _engine_kwargs("sqlite:///./orders.db")

        assert kwargs["connect_args"] == {"check_same_thread": False}

    def test_sqlite_does_not_receive_postgres_pool_settings(self):
        kwargs = _engine_kwargs("sqlite:///./orders.db")

        assert "pool_size" not in kwargs
        assert "pool_recycle" not in kwargs


class TestTransactionPoolerCompatibility:
    """Supabase exposes session (5432) and transaction (6543) pooling on the
    same hostname. Only the port distinguishes them, and picking the wrong one
    fails intermittently rather than immediately."""

    def test_recognises_the_transaction_pooler_by_port(self):
        assert uses_transaction_pooler(TRANSACTION_POOLER_URL) is True

    def test_does_not_flag_the_session_pooler(self):
        assert uses_transaction_pooler(PRODUCTION_URL) is False

    def test_does_not_flag_a_direct_connection(self):
        url = "postgresql+psycopg://postgres:pw@db.abcdefgh.supabase.co:5432/postgres"

        assert uses_transaction_pooler(url) is False

    def test_does_not_flag_sqlite(self):
        assert uses_transaction_pooler("sqlite:///./orders.db") is False

    def test_a_malformed_url_does_not_raise_here(self):
        """It should fail at connect time with a useful message, not during
        engine configuration with a confusing one."""
        assert uses_transaction_pooler("not a url at all") is False

    def test_disables_prepared_statements_behind_the_transaction_pooler(self):
        """Otherwise psycopg starts preparing statements after a few executions
        and they vanish when the next transaction lands on another backend."""
        kwargs = _engine_kwargs(TRANSACTION_POOLER_URL)

        assert kwargs["connect_args"] == {"prepare_threshold": None}

    def test_keeps_prepared_statements_on_the_session_pooler(self):
        """Session mode holds one backend per connection, so the optimisation
        is safe and worth keeping."""
        kwargs = _engine_kwargs(PRODUCTION_URL)

        assert "connect_args" not in kwargs

    def test_the_engine_accepts_the_transaction_pooler_settings(self):
        engine = create_engine(TRANSACTION_POOLER_URL, **_engine_kwargs(TRANSACTION_POOLER_URL))

        assert engine.dialect.driver == "psycopg"


class TestPostgresSchemaCompatibility:
    def test_order_status_is_a_plain_varchar_not_a_postgres_enum(self):
        """A native ENUM type would need a migration every time a status is
        added, and `create_all` would not apply it. `native_enum=False` keeps
        the column a string; this guards that decision."""
        ddl = postgres_ddl("orders")

        assert "status VARCHAR(32) NOT NULL" in ddl
        assert "CREATE TYPE" not in ddl.upper()

    def test_timestamps_keep_their_timezone(self):
        """Postgres then returns aware datetimes, which `ensure_utc` normalises."""
        ddl = postgres_ddl("orders")

        assert "created_at TIMESTAMP WITH TIME ZONE" in ddl
        assert "updated_at TIMESTAMP WITH TIME ZONE" in ddl

    def test_order_lines_are_deleted_with_their_order(self):
        ddl = postgres_ddl("order_items")

        assert "ON DELETE CASCADE" in ddl

    def test_deleting_a_menu_item_preserves_order_history(self):
        """The line keeps its snapshotted name and price; only the link is cleared."""
        ddl = postgres_ddl("order_items")

        assert "ON DELETE SET NULL" in ddl

    def test_the_public_order_id_is_unique(self):
        """It is the only thing protecting one customer's order from another."""
        table = Base.metadata.tables["orders"]

        assert table.columns["public_id"].unique is True

    def test_every_table_compiles_for_postgres(self):
        for table_name in Base.metadata.tables:
            assert postgres_ddl(table_name).startswith("\nCREATE TABLE")
