"""Settings, especially the database URL rewriting.

A URL copied from a hosting provider's dashboard has to work verbatim. Getting
this wrong is invisible locally on SQLite and only fails once deployed, so the
rewriting is pinned down here.
"""

from __future__ import annotations

import pytest

from app.config import Settings, normalise_database_url

NEON_URL = "postgres://user:pw@ep-cool-name-123.eu-central-1.aws.neon.tech/neondb?sslmode=require"


class TestNormaliseDatabaseUrl:
    def test_rewrites_the_bare_postgres_scheme(self):
        """SQLAlchemy 2.0 rejects `postgres://`, which is what most providers give."""
        result = normalise_database_url("postgres://user:pw@host:5432/orders")

        assert result == "postgresql+psycopg://user:pw@host:5432/orders"

    def test_rewrites_postgresql_to_the_installed_driver(self):
        """A bare `postgresql://` selects psycopg2, which is not installed."""
        result = normalise_database_url("postgresql://user:pw@host:5432/orders")

        assert result == "postgresql+psycopg://user:pw@host:5432/orders"

    def test_preserves_credentials_host_port_and_database(self):
        result = normalise_database_url("postgres://u:p@db.example.com:6543/mydb")

        assert result.endswith("//u:p@db.example.com:6543/mydb")

    def test_preserves_query_parameters(self):
        """Neon and Supabase require sslmode, which lives in the query string."""
        result = normalise_database_url(NEON_URL)

        assert result.startswith("postgresql+psycopg://")
        assert result.endswith("?sslmode=require")

    def test_leaves_an_explicitly_chosen_driver_alone(self):
        """If the caller named a driver, that is a decision, not a mistake."""
        url = "postgresql+asyncpg://user:pw@host/orders"

        assert normalise_database_url(url) == url

    def test_is_idempotent(self):
        once = normalise_database_url(NEON_URL)

        assert normalise_database_url(once) == once

    @pytest.mark.parametrize(
        "url",
        [
            "sqlite:///./orders.db",
            "sqlite:////tmp/orders.db",
            "sqlite:///:memory:",
        ],
    )
    def test_leaves_sqlite_untouched(self, url):
        assert normalise_database_url(url) == url

    def test_trims_stray_whitespace(self):
        """Pasted values pick up trailing newlines with depressing regularity."""
        result = normalise_database_url("  postgres://user:pw@host/orders\n")

        assert result == "postgresql+psycopg://user:pw@host/orders"


class TestSettings:
    def test_applies_the_rewrite_to_the_environment_value(self, monkeypatch):
        monkeypatch.setenv("DATABASE_URL", "postgres://user:pw@host/orders")

        assert Settings().database_url == "postgresql+psycopg://user:pw@host/orders"

    def test_reports_sqlite_correctly(self, monkeypatch):
        monkeypatch.setenv("DATABASE_URL", "sqlite:///./orders.db")
        assert Settings().is_sqlite is True

        monkeypatch.setenv("DATABASE_URL", "postgres://user:pw@host/orders")
        assert Settings().is_sqlite is False

    def test_accepts_cors_origins_as_a_comma_separated_string(self, monkeypatch):
        """The form a person types into a hosting dashboard, and what the
        deployment docs tell them to use."""
        monkeypatch.setenv("CORS_ORIGINS", "https://a.example.com, https://b.example.com")

        assert Settings().cors_origins == ["https://a.example.com", "https://b.example.com"]

    def test_accepts_cors_origins_as_a_json_array(self, monkeypatch):
        """The form infrastructure tooling tends to emit."""
        monkeypatch.setenv("CORS_ORIGINS", '["https://a.example.com","https://b.example.com"]')

        assert Settings().cors_origins == ["https://a.example.com", "https://b.example.com"]

    def test_accepts_a_single_origin(self, monkeypatch):
        monkeypatch.setenv("CORS_ORIGINS", "https://forkful.vercel.app")

        assert Settings().cors_origins == ["https://forkful.vercel.app"]

    def test_ignores_blank_entries_in_the_cors_list(self, monkeypatch):
        monkeypatch.setenv("CORS_ORIGINS", "https://a.example.com,,  ,")

        assert Settings().cors_origins == ["https://a.example.com"]

    def test_falls_back_to_local_dev_origins_when_unset(self, monkeypatch):
        monkeypatch.delenv("CORS_ORIGINS", raising=False)

        assert "http://localhost:5173" in Settings().cors_origins
