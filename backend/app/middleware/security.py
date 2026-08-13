"""Security headers and a request body size cap."""

from __future__ import annotations

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.types import ASGIApp

# This service returns JSON only, so the policy can be maximally restrictive:
# nothing is allowed to load, and the response may not be framed.
_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "Cross-Origin-Resource-Policy": "same-site",
}

# Docs pages need to load their own CSS/JS from a CDN, so they opt out.
_DOCS_PATHS = frozenset({"/docs", "/redoc", "/openapi.json"})


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:  # noqa: ANN001
        response = await call_next(request)
        if request.url.path not in _DOCS_PATHS:
            for header, value in _HEADERS.items():
                response.headers.setdefault(header, value)
        return response


class BodySizeLimitMiddleware(BaseHTTPMiddleware):
    """Reject oversized payloads before they are parsed.

    Pydantic caps the number of items in an order, but that check runs after
    the body has been read into memory. Refusing on `Content-Length` keeps a
    multi-megabyte POST from being buffered at all.
    """

    def __init__(self, app: ASGIApp, *, max_bytes: int = 64 * 1024) -> None:
        super().__init__(app)
        self.max_bytes = max_bytes

    async def dispatch(self, request: Request, call_next) -> Response:  # noqa: ANN001
        content_length = request.headers.get("content-length")
        if content_length is not None:
            try:
                declared = int(content_length)
            except ValueError:
                declared = 0
            if declared > self.max_bytes:
                return JSONResponse(
                    status_code=413,
                    content={
                        "error": {
                            "code": "payload_too_large",
                            "message": f"Request body must be {self.max_bytes} bytes or fewer.",
                            "details": {"max_bytes": self.max_bytes},
                        }
                    },
                )
        return await call_next(request)
