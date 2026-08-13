"""Pricing rules.

Pure functions, so these are plain unit tests with no database involved.
"""

from __future__ import annotations

import pytest

from app.services.pricing import (
    DELIVERY_FEE_CENTS,
    FREE_DELIVERY_THRESHOLD_CENTS,
    calculate_total,
    delivery_fee_for,
)


def test_charges_the_flat_fee_below_the_threshold():
    assert delivery_fee_for(FREE_DELIVERY_THRESHOLD_CENTS - 1) == DELIVERY_FEE_CENTS


def test_waives_the_fee_exactly_at_the_threshold():
    """Boundary: "spend 25 for free delivery" must be satisfied by spending 25."""
    assert delivery_fee_for(FREE_DELIVERY_THRESHOLD_CENTS) == 0


def test_waives_the_fee_above_the_threshold():
    assert delivery_fee_for(FREE_DELIVERY_THRESHOLD_CENTS + 500) == 0


def test_an_empty_basket_totals_zero_plus_the_fee():
    breakdown = calculate_total([])

    assert breakdown.subtotal_cents == 0
    assert breakdown.total_cents == DELIVERY_FEE_CENTS


def test_sums_line_totals():
    breakdown = calculate_total([1150, 1150, 590])

    assert breakdown.subtotal_cents == 2890
    assert breakdown.delivery_fee_cents == 0
    assert breakdown.total_cents == 2890


def test_total_is_always_subtotal_plus_fee():
    for subtotal in (1, 299, 2499, 2500, 100_000):
        breakdown = calculate_total([subtotal])
        assert breakdown.total_cents == breakdown.subtotal_cents + breakdown.delivery_fee_cents


@pytest.mark.parametrize("lines", [[333, 333, 334], [1, 1, 1], [999, 1]])
def test_arithmetic_is_exact_because_money_is_integer_cents(lines):
    """The reason prices are ints: no rounding drift can accumulate."""
    breakdown = calculate_total(lines)

    assert breakdown.subtotal_cents == sum(lines)
    assert isinstance(breakdown.subtotal_cents, int)
