"""Application settings, loaded from environment variables."""

import json
from functools import lru_cache
from typing import Annotated

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

# Hosted Postgres providers (Neon, Supabase, Render, Heroku) hand out URLs
# beginning `postgres://`, and a bare `postgresql://` selects psycopg2, which
# this project does not install. SQLAlchemy 2.0 rejects the former outright, so
# a URL pasted straight from a provider's dashboard fails at startup with a
# message that does not obviously point at the scheme. Rewriting it here means
# the value can be copied verbatim.
_POSTGRES_DRIVER = "postgresql+psycopg"
_LEGACY_POSTGRES_SCHEMES = ("postgres://", "postgresql://")


def normalise_database_url(url: str) -> str:
    """Point any Postgres URL at the psycopg 3 driver, leaving others alone.

    An explicit driver the caller chose (`postgresql+asyncpg://`, say) is
    respected rather than overridden.
    """
    stripped = url.strip()
    for scheme in _LEGACY_POSTGRES_SCHEMES:
        if stripped.startswith(scheme):
            return f"{_POSTGRES_DRIVER}://{stripped[len(scheme):]}"
    return stripped


class Settings(BaseSettings):
    """Runtime configuration.

    Every value has a development-friendly default so the app boots with no
    .env file, but anything environment-specific (CORS origins, database URL)
    is expected to be overridden in production.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "Order Management API"
    environment: str = "development"
    debug: bool = True

    database_url: str = "sqlite:///./orders.db"

    # Comma-separated list in the environment, e.g.
    #   CORS_ORIGINS=https://my-app.vercel.app,http://localhost:5173
    #
    # `NoDecode` is essential here. Without it pydantic-settings JSON-decodes
    # any complex-typed environment value *before* validators run, so a
    # comma-separated string raises a SettingsError at import time and the
    # process dies before it can serve or log anything useful. NoDecode hands
    # the raw string to `_split_origins` instead.
    cors_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: [
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:4173",
        ]
    )

    # Seconds each status is held before the simulator advances the order.
    # Kept short so the real-time behaviour is visible during a demo.
    status_step_seconds: float = 12.0
    # How often the simulator wakes up to look for orders that are due.
    simulator_tick_seconds: float = 1.0
    # Set False in tests so the loop does not fight with assertions.
    enable_status_simulator: bool = True

    # Naive fixed-window rate limit, applied per client IP to write endpoints.
    rate_limit_requests: int = 30
    rate_limit_window_seconds: int = 60

    # Guardrails that keep a single request from being unbounded.
    max_items_per_order: int = 50
    max_quantity_per_item: int = 20

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        """Accept CORS_ORIGINS as a comma-separated string or a JSON array.

        Comma-separated is what a person types into a hosting dashboard; a JSON
        array is what infrastructure tooling tends to emit. Both are supported
        because getting this wrong only surfaces on deploy.
        """
        if not isinstance(value, str):
            return value

        candidate = value.strip()
        if candidate.startswith("["):
            return json.loads(candidate)
        return [origin.strip() for origin in candidate.split(",") if origin.strip()]

    @field_validator("database_url", mode="after")
    @classmethod
    def _normalise_database_url(cls, value: str) -> str:
        return normalise_database_url(value)

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")


@lru_cache
def get_settings() -> Settings:
    """Return the process-wide settings singleton."""
    return Settings()


settings = get_settings()
