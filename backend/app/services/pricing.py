"""Pricing rules, kept separate so they are easy to read and to test.

Everything is integer cents, so there is no floating point rounding anywhere
in the money path.
"""

from __future__ import annotations

from typing import NamedTuple

DELIVERY_FEE_CENTS = 299
FREE_DELIVERY_THRESHOLD_CENTS = 2500


class PriceBreakdown(NamedTuple):
    subtotal_cents: int
    delivery_fee_cents: int
    total_cents: int


def delivery_fee_for(subtotal_cents: int) -> int:
    """Flat fee, waived once the basket is large enough."""
    if subtotal_cents >= FREE_DELIVERY_THRESHOLD_CENTS:
        return 0
    return DELIVERY_FEE_CENTS


def calculate_total(line_totals_cents: list[int]) -> PriceBreakdown:
    subtotal = sum(line_totals_cents)
    delivery_fee = delivery_fee_for(subtotal)
    return PriceBreakdown(
        subtotal_cents=subtotal,
        delivery_fee_cents=delivery_fee,
        total_cents=subtotal + delivery_fee,
    )
