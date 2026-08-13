"""Domain exceptions and the handlers that map them to HTTP responses.

Routes raise domain errors; a single set of handlers turns them into a
consistent JSON envelope. That keeps HTTP concerns out of the service layer
and gives the frontend one error shape to parse:

    {"error": {"code": "order_not_found", "message": "...", "details": {...}}}
"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


class DomainError(Exception):
    """Base class for expected, client-facing failures."""

    status_code: int = status.HTTP_400_BAD_REQUEST
    code: str = "domain_error"

    def __init__(self, message: str, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.details = details or {}


class NotFoundError(DomainError):
    status_code = status.HTTP_404_NOT_FOUND
    code = "not_found"


class OrderNotFoundError(NotFoundError):
    code = "order_not_found"

    def __init__(self, order_id: str) -> None:
        super().__init__(f"No order found with id {order_id!r}", {"order_id": order_id})


class MenuItemNotFoundError(NotFoundError):
    code = "menu_item_not_found"

    def __init__(self, menu_item_ids: list[int]) -> None:
        ids = ", ".join(str(i) for i in menu_item_ids)
        super().__init__(
            f"Menu item(s) not found or unavailable: {ids}",
            {"menu_item_ids": menu_item_ids},
        )


class InvalidStatusTransitionError(DomainError):
    status_code = status.HTTP_409_CONFLICT
    code = "invalid_status_transition"

    def __init__(self, current: str, target: str) -> None:
        super().__init__(
            f"Cannot change order status from {current!r} to {target!r}",
            {"current_status": current, "target_status": target},
        )


class OrderNotCancellableError(DomainError):
    status_code = status.HTTP_409_CONFLICT
    code = "order_not_cancellable"

    def __init__(self, current: str) -> None:
        super().__init__(
            f"An order with status {current!r} can no longer be cancelled",
            {"current_status": current},
        )


class RateLimitExceededError(DomainError):
    status_code = status.HTTP_429_TOO_MANY_REQUESTS
    code = "rate_limit_exceeded"

    def __init__(self, retry_after: int) -> None:
        super().__init__(
            "Too many requests. Please slow down and try again shortly.",
            {"retry_after_seconds": retry_after},
        )


def _envelope(code: str, message: str, details: dict[str, Any] | None = None) -> dict[str, Any]:
    return {"error": {"code": code, "message": message, "details": details or {}}}


def register_exception_handlers(app: FastAPI) -> None:
    """Attach the JSON error envelope handlers to an app."""

    @app.exception_handler(DomainError)
    async def _domain_error_handler(_: Request, exc: DomainError) -> JSONResponse:
        headers = {}
        if isinstance(exc, RateLimitExceededError):
            headers["Retry-After"] = str(exc.details.get("retry_after_seconds", 60))
        return JSONResponse(
            status_code=exc.status_code,
            content=_envelope(exc.code, exc.message, exc.details),
            headers=headers,
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_error_handler(
        _: Request, exc: RequestValidationError
    ) -> JSONResponse:
        # Flatten Pydantic's error list into field -> message so the UI can
        # attach messages to the right form input.
        fields: dict[str, str] = {}
        for error in exc.errors():
            location = [str(part) for part in error["loc"] if part not in ("body", "query")]
            key = ".".join(location) or "body"
            fields.setdefault(key, error["msg"])
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content=_envelope(
                "validation_error",
                "The submitted data is invalid.",
                {"fields": fields},
            ),
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http_error_handler(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=_envelope("http_error", str(exc.detail)),
            headers=getattr(exc, "headers", None),
        )
