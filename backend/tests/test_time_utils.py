"""UTC normalisation.

SQLite drops the timezone offset when it stores a datetime, so values read back
are naive. Serialising those without a marker would make the browser interpret
them as local time and shift every relative timestamp in the UI.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.utils.time import ensure_utc, utcnow


def test_utcnow_is_timezone_aware():
    assert utcnow().tzinfo is timezone.utc


def test_a_naive_value_is_interpreted_as_utc():
    naive = datetime(2026, 8, 12, 16, 30, 0)

    result = ensure_utc(naive)

    assert result.tzinfo is timezone.utc
    assert result.hour == 16  # the clock reading is preserved, not shifted


def test_an_aware_value_is_converted_to_utc():
    ist = timezone(timedelta(hours=5, minutes=30))
    aware = datetime(2026, 8, 12, 22, 0, 0, tzinfo=ist)

    result = ensure_utc(aware)

    assert result.tzinfo is timezone.utc
    assert (result.hour, result.minute) == (16, 30)


def test_a_utc_value_passes_through_unchanged():
    original = datetime(2026, 8, 12, 16, 30, tzinfo=timezone.utc)

    assert ensure_utc(original) == original
