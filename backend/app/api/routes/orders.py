"""Order endpoints.

Handlers are declared `def` rather than `async def` on purpose: SQLAlchemy's
sync session blocks, and FastAPI runs sync handlers in a worker thread, so the
event loop stays free to service WebSocket traffic.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query, status

from app.api.deps import OrderServiceDep
from app.middleware.rate_limit import rate_limit_dependency
from app.models import OrderStatus
from app.schemas import OrderCreate, OrderRead, OrderStatusUpdate, OrderSummary

router = APIRouter(prefix="/orders", tags=["orders"])

# Order ids are UUID4 strings. Validating the shape at the edge means a
# malformed id is a clean 422 instead of a pointless database round trip.
_UUID_PATTERN = r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"

OrderId = Annotated[
    str,
    Path(pattern=_UUID_PATTERN, description="Public order identifier (UUID)"),
]


@router.post(
    "",
    response_model=OrderRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(rate_limit_dependency)],
    summary="Place an order",
)
def create_order(payload: OrderCreate, service: OrderServiceDep) -> OrderRead:
    """Create an order from the cart contents and delivery details.

    Line prices are read from the menu server-side; the client sends only
    menu item ids and quantities.
    """
    order = service.create_order(payload)
    return OrderRead.model_validate(order)


@router.get("", response_model=list[OrderSummary], summary="List orders")
def list_orders(
    service: OrderServiceDep,
    ids: Annotated[
        str | None,
        Query(
            max_length=2000,
            description="Comma-separated order ids to hydrate, e.g. the ids the browser has stored.",
        ),
    ] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[OrderSummary]:
    """Return order summaries.

    With `ids`, returns just those orders -- how the browser rehydrates the
    order history it keeps in localStorage. Without it, returns the most recent
    orders, which backs the kitchen-side view.
    """
    if ids is not None:
        wanted = [part.strip() for part in ids.split(",") if part.strip()][:100]
        orders = service.list_by_ids(wanted)
    else:
        orders = service.list_recent(limit=limit, offset=offset)
    return [OrderSummary.model_validate(order) for order in orders]


@router.get("/{order_id}", response_model=OrderRead, summary="Get one order")
def get_order(order_id: OrderId, service: OrderServiceDep) -> OrderRead:
    order = service.get_order(order_id)
    return OrderRead.model_validate(order)


@router.patch(
    "/{order_id}/status",
    response_model=OrderRead,
    dependencies=[Depends(rate_limit_dependency)],
    summary="Update order status",
)
def update_order_status(
    order_id: OrderId,
    payload: OrderStatusUpdate,
    service: OrderServiceDep,
) -> OrderRead:
    """Move an order to a new status.

    Only transitions permitted by the state machine are accepted; anything
    else is a 409. Setting the status it already has is a no-op, which keeps
    a retried request safe.
    """
    order = service.update_status(order_id, payload.status, note=payload.note)
    return OrderRead.model_validate(order)


@router.delete(
    "/{order_id}",
    response_model=OrderRead,
    dependencies=[Depends(rate_limit_dependency)],
    summary="Cancel an order",
)
def cancel_order(order_id: OrderId, service: OrderServiceDep) -> OrderRead:
    """Cancel an order.

    A soft delete: the row is kept and moved to `Cancelled` rather than being
    removed, because an order that a kitchen may already have acted on is
    business history. Only possible before the rider collects it.
    """
    order = service.cancel_order(order_id)
    return OrderRead.model_validate(order)


@router.get("/meta/statuses", response_model=list[str], summary="List order statuses")
def list_statuses() -> list[str]:
    """The status vocabulary, so the UI does not hard-code its own copy."""
    return [status_.value for status_ in OrderStatus]
