"""Rate limiting on write endpoints."""

from __future__ import annotations

import pytest

from app.errors import RateLimitExceededError
from app.middleware.rate_limit import RateLimiter


@pytest.fixture
def small_limiter() -> RateLimiter:
    return RateLimiter(max_requests=3, window_seconds=60)


def test_allows_requests_up_to_the_limit(small_limiter):
    for _ in range(3):
        small_limiter.check("1.2.3.4")


def test_blocks_the_request_that_exceeds_the_limit(small_limiter):
    for _ in range(3):
        small_limiter.check("1.2.3.4")

    with pytest.raises(RateLimitExceededError) as exc_info:
        small_limiter.check("1.2.3.4")

    assert exc_info.value.status_code == 429
    assert exc_info.value.details["retry_after_seconds"] > 0


def test_counts_each_client_separately(small_limiter):
    for _ in range(3):
        small_limiter.check("1.2.3.4")

    small_limiter.check("5.6.7.8")  # a different client is unaffected


def test_the_window_slides_so_old_hits_stop_counting(small_limiter):
    """Driven with an injected clock rather than sleeping for a minute."""
    for tick in range(3):
        small_limiter.check("1.2.3.4", now=float(tick))

    with pytest.raises(RateLimitExceededError):
        small_limiter.check("1.2.3.4", now=10.0)

    # Once the first hits age out of the window, capacity returns.
    small_limiter.check("1.2.3.4", now=61.0)


def test_reset_clears_all_counters(small_limiter):
    for _ in range(3):
        small_limiter.check("1.2.3.4")

    small_limiter.reset()

    small_limiter.check("1.2.3.4")


def test_order_creation_is_rate_limited(client, make_order_payload, monkeypatch):
    from app.middleware import rate_limit

    monkeypatch.setattr(rate_limit.limiter, "max_requests", 2)
    rate_limit.limiter.reset()

    assert client.post("/api/orders", json=make_order_payload()).status_code == 201
    assert client.post("/api/orders", json=make_order_payload()).status_code == 201

    response = client.post("/api/orders", json=make_order_payload())

    assert response.status_code == 429
    assert response.json()["error"]["code"] == "rate_limit_exceeded"
    assert "Retry-After" in response.headers


def test_reads_are_not_rate_limited(client, monkeypatch):
    """Browsing the menu must never be throttled."""
    from app.middleware import rate_limit

    monkeypatch.setattr(rate_limit.limiter, "max_requests", 2)
    rate_limit.limiter.reset()

    for _ in range(10):
        assert client.get("/api/menu").status_code == 200
