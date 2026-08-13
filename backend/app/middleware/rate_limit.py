"""A small fixed-window rate limiter for write endpoints.

Deliberately in-process and dependency-free: it stops a single client from
hammering order creation during a demo without adding Redis to the stack. It
is not a substitute for a real limiter -- with several workers each process
keeps its own counters, and the client key comes from the peer address, which
a proxy can rewrite. In production this belongs at the edge (API gateway or
`slowapi` backed by Redis); the note is here so the trade-off is explicit
rather than accidental.
"""

from __future__ import annotations

import threading
import time
from collections import defaultdict, deque

from fastapi import Request

from app.config import settings
from app.errors import RateLimitExceededError


class RateLimiter:
    """Counts recent hits per key inside a sliding window."""

    def __init__(self, *, max_requests: int, window_seconds: int) -> None:
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def check(self, key: str, *, now: float | None = None) -> None:
        """Record a hit for `key`, raising once the window is full."""
        current = time.monotonic() if now is None else now
        cutoff = current - self.window_seconds

        with self._lock:
            hits = self._hits[key]
            while hits and hits[0] <= cutoff:
                hits.popleft()

            if len(hits) >= self.max_requests:
                retry_after = max(1, int(hits[0] + self.window_seconds - current) + 1)
                raise RateLimitExceededError(retry_after)

            hits.append(current)

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


limiter = RateLimiter(
    max_requests=settings.rate_limit_requests,
    window_seconds=settings.rate_limit_window_seconds,
)


def client_key(request: Request) -> str:
    """Identify the caller. Trusts `X-Forwarded-For` only for its first hop."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def rate_limit_dependency(request: Request) -> None:
    """Attach to a route to rate limit it per client."""
    limiter.check(client_key(request))
