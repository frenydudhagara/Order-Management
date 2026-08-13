"""Time helpers.

SQLite has no native timestamp type: SQLAlchemy formats datetimes into strings
and drops the UTC offset, so values read back are naive even though they were
written as UTC. A naive timestamp serialised without a `Z` is parsed by the
browser as *local* time, which silently shifts every "placed 2 minutes ago"
label by the client's offset. `UtcDatetime` re-attaches UTC on the way out so
the API always emits an unambiguous instant.
"""

from datetime import datetime, timezone
from typing import Annotated

from pydantic import AfterValidator


def utcnow() -> datetime:
    """Timezone-aware current UTC time."""
    return datetime.now(timezone.utc)


def ensure_utc(value: datetime) -> datetime:
    """Interpret a naive datetime as UTC; normalise an aware one to UTC."""
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


UtcDatetime = Annotated[datetime, AfterValidator(ensure_utc)]
