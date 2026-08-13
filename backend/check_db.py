"""Verify a DATABASE_URL before deploying with it: `python check_db.py`.

Reads the connection string from the environment (or `backend/.env`), connects,
creates the schema and seeds the menu, then reports what it found. Nothing is
printed with the password in it.

Catching a bad connection string here takes seconds. Catching it on a hosting
platform means waiting out a container build for each attempt, and reading the
failure through a log aggregator.
"""

from __future__ import annotations

import sys

from sqlalchemy import create_engine, func, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import SQLAlchemyError

from app.config import settings
from app.database import Base, _engine_kwargs, uses_transaction_pooler
from app.models import MenuItem, Order
from app.seed import seed_menu

CONNECT_TIMEOUT_SECONDS = 10

TICK = "[ ok ]"
WARN = "[warn]"
FAIL = "[fail]"


def redacted(url: str) -> str:
    """The URL with its password replaced, safe to print or paste into a chat."""
    try:
        parsed = make_url(url)
    except Exception:  # noqa: BLE001
        return "<unparseable URL>"
    return parsed.render_as_string(hide_password=True)


def inspect_url(url: str) -> list[str]:
    """Warn about connection strings that are valid but will not work in prod."""
    problems: list[str] = []

    try:
        parsed = make_url(url)
    except Exception as exc:  # noqa: BLE001
        return [f"{FAIL} The URL could not be parsed: {exc}"]

    if parsed.drivername.startswith("sqlite"):
        problems.append(
            f"{WARN} This is SQLite, not Postgres. Fine locally, but the deployed\n"
            "       API needs a durable database -- free hosts wipe the container\n"
            "       filesystem on every restart and deploy."
        )
        return problems

    password = parsed.password or ""
    if password.startswith("[") or password.endswith("]"):
        problems.append(
            f"{FAIL} The password still has square brackets around it. Those are the\n"
            "       dashboard's placeholder markers, not part of the value -- and\n"
            "       they are reserved characters in a URL. Remove them."
        )
    if "YOUR-PASSWORD" in password.upper() or not password:
        problems.append(f"{FAIL} The password placeholder has not been substituted.")

    host = parsed.host or ""
    if host.startswith("db.") and host.endswith(".supabase.co"):
        problems.append(
            f"{WARN} This is Supabase's direct connection host, which is IPv6-only.\n"
            "       It may work from here but will fail on an IPv4-only host such as\n"
            "       Render's free tier. Use Connect -> Session pooler instead:\n"
            "       aws-0-<region>.pooler.supabase.com:5432"
        )

    if uses_transaction_pooler(url):
        problems.append(
            f"{WARN} Port 6543 is the transaction pooler. It works -- prepared\n"
            "       statements are disabled automatically -- but session mode\n"
            "       (port 5432) suits a long-running server better."
        )

    return problems


def explain(error: Exception) -> str:
    """Map the usual connection failures onto the thing that actually caused them."""
    message = str(error).lower()

    if "password authentication failed" in message:
        return (
            "The password was rejected. Reset it in Supabase (Settings -> Database)\n"
            "and copy the new connection string. If it contains @ : / ? # or %,\n"
            "percent-encode them (@ becomes %40)."
        )
    if "tenant or user not found" in message:
        return (
            "The pooler did not recognise the username. Through the session pooler\n"
            "it must be postgres.<project-ref>, not plain postgres. Copy the string\n"
            "from Connect -> Session pooler rather than editing one by hand."
        )
    # Wording varies by platform: Linux says "could not translate host name",
    # Windows raises getaddrinfo/11001, and an IPv6-only address reached from
    # an IPv4-only network says "network is unreachable".
    dns_failures = (
        "network is unreachable",
        "could not translate host name",
        "getaddrinfo",
        "name or service not known",
        "nodename nor servname",
    )
    if any(pattern in message for pattern in dns_failures):
        return (
            "The host could not be reached, so it is wrong or unroutable from here.\n"
            "If it is db.<ref>.supabase.co, that address is IPv6-only -- copy the\n"
            "session pooler string from Connect instead. Otherwise check the\n"
            "hostname for a typo."
        )
    if "timeout" in message or "timed out" in message:
        return (
            "The connection timed out. Usually a paused Supabase project (free\n"
            "projects pause after about a week idle -- resume it in the dashboard)\n"
            "or a firewall in the way."
        )
    if "does not exist" in message and "database" in message:
        return "That database name does not exist. Supabase's is `postgres`."
    return "Check the host, port, username and password against the dashboard."


def main() -> int:
    url = settings.database_url

    print(f"\nDATABASE_URL : {redacted(url)}")
    print(f"Driver       : {make_url(url).drivername}\n")

    problems = inspect_url(url)
    for problem in problems:
        print(problem)
    if any(problem.startswith(FAIL) for problem in problems):
        print("\nFix the above and run this again.")
        return 1
    if problems:
        print()

    engine_kwargs = _engine_kwargs(url)
    if not url.startswith("sqlite"):
        connect_args = dict(engine_kwargs.get("connect_args", {}))
        connect_args["connect_timeout"] = CONNECT_TIMEOUT_SECONDS
        engine_kwargs["connect_args"] = connect_args

    engine = create_engine(url, **engine_kwargs)

    # `version()` is Postgres; SQLite spells it differently.
    version_query = "SELECT sqlite_version()" if url.startswith("sqlite") else "SELECT version()"

    try:
        with engine.connect() as connection:
            version = connection.execute(text(version_query)).scalar_one()
        print(f"{TICK} Connected")
        print(f"       {str(version).split(' on ')[0]}")
    except SQLAlchemyError as exc:
        print(f"{FAIL} Could not connect.\n")
        print(f"       {type(exc).__name__}: {str(exc).strip().splitlines()[0]}\n")
        print(explain(exc))
        return 1

    try:
        Base.metadata.create_all(bind=engine)
        print(f"{TICK} Schema created (or already present)")

        with engine.connect() as connection:
            menu_before = connection.execute(
                select(func.count()).select_from(MenuItem)
            ).scalar_one()

        from sqlalchemy.orm import Session

        with Session(engine) as session:
            inserted = seed_menu(session)

        with engine.connect() as connection:
            menu_count = connection.execute(
                select(func.count()).select_from(MenuItem)
            ).scalar_one()
            order_count = connection.execute(
                select(func.count()).select_from(Order)
            ).scalar_one()

        if inserted:
            print(f"{TICK} Seeded {inserted} menu items (writes work)")
        else:
            print(f"{TICK} Menu already seeded, left alone ({menu_before} items)")

        print(f"\n       menu items : {menu_count}")
        print(f"       orders     : {order_count}")

    except SQLAlchemyError as exc:
        print(f"{FAIL} Connected, but could not set up the schema.\n")
        print(f"       {type(exc).__name__}: {str(exc).strip().splitlines()[0]}")
        return 1
    finally:
        engine.dispose()

    print("\nThis connection string is good. Set it as DATABASE_URL on your host.\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
