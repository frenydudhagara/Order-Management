"""Order schemas.

All customer input is validated here so that route handlers and the service
layer can assume well-formed data. Anything money-related is deliberately
absent from the request models: the server recomputes prices from the menu so
a tampered client cannot buy a pizza for one cent.
"""

from __future__ import annotations

import re

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    computed_field,
    field_validator,
    model_validator,
)

from app.config import settings
from app.models.order import OrderStatus
from app.utils.time import UtcDatetime

# Permissive enough for international numbers, strict enough to reject prose.
# Digits, spaces, dashes, dots, parens and a single leading +.
_PHONE_ALLOWED = re.compile(r"^\+?[\d\s\-.()]+$")
_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def _strip_control_chars(value: str) -> str:
    """Remove control characters that have no business in a text field."""
    return _CONTROL_CHARS.sub("", value)


class OrderItemCreate(BaseModel):
    """One requested line: which menu item, and how many."""

    model_config = ConfigDict(extra="forbid")

    menu_item_id: int = Field(gt=0)
    quantity: int = Field(ge=1, le=settings.max_quantity_per_item)


class OrderCreate(BaseModel):
    """Checkout payload."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    customer_name: str = Field(min_length=2, max_length=120)
    phone: str = Field(min_length=7, max_length=32)
    address: str = Field(min_length=10, max_length=500)
    notes: str = Field(default="", max_length=500)
    items: list[OrderItemCreate] = Field(min_length=1, max_length=settings.max_items_per_order)

    @field_validator("customer_name", "address", "notes")
    @classmethod
    def _clean_text(cls, value: str) -> str:
        return _strip_control_chars(value).strip()

    @field_validator("customer_name")
    @classmethod
    def _name_must_have_letters(cls, value: str) -> str:
        if not any(char.isalpha() for char in value):
            raise ValueError("Name must contain at least one letter")
        return value

    @field_validator("phone")
    @classmethod
    def _validate_phone(cls, value: str) -> str:
        if not _PHONE_ALLOWED.match(value):
            raise ValueError("Phone number contains invalid characters")
        digits = re.sub(r"\D", "", value)
        if not 7 <= len(digits) <= 15:
            raise ValueError("Phone number must contain between 7 and 15 digits")
        return value

    @model_validator(mode="after")
    def _reject_duplicate_menu_items(self) -> OrderCreate:
        """Two lines for the same dish are ambiguous -- the client should merge
        them into one line with a summed quantity instead."""
        seen = [item.menu_item_id for item in self.items]
        if len(seen) != len(set(seen)):
            raise ValueError("Duplicate menu_item_id in items; merge them into a single line")
        return self


class OrderStatusUpdate(BaseModel):
    """Manual status change, used by staff tooling and the demo controls."""

    model_config = ConfigDict(extra="forbid")

    status: OrderStatus
    note: str = Field(default="", max_length=280)


class OrderItemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    menu_item_id: int | None
    name: str
    unit_price_cents: int
    quantity: int
    image_url: str

    @computed_field  # type: ignore[prop-decorator]
    @property
    def line_total_cents(self) -> int:
        return self.unit_price_cents * self.quantity


class OrderStatusEventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    status: OrderStatus
    note: str
    created_at: UtcDatetime


class OrderRead(BaseModel):
    """Full order detail, keyed by the public UUID."""

    model_config = ConfigDict(from_attributes=True)

    id: str = Field(validation_alias="public_id", description="Public order identifier")
    status: OrderStatus
    customer_name: str
    phone: str
    address: str
    notes: str
    subtotal_cents: int
    delivery_fee_cents: int
    total_cents: int
    created_at: UtcDatetime
    updated_at: UtcDatetime
    items: list[OrderItemRead]
    events: list[OrderStatusEventRead] = Field(default_factory=list)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def next_status(self) -> OrderStatus | None:
        """What the simulator will advance to next, or null if the order is done."""
        return self.status.next_status


class OrderSummary(BaseModel):
    """Lighter projection for list views."""

    model_config = ConfigDict(from_attributes=True)

    id: str = Field(validation_alias="public_id")
    status: OrderStatus
    total_cents: int
    created_at: UtcDatetime
    item_count: int = 0
