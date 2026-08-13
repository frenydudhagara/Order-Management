/** Cart rules. Pure reducer, so no React involved. */

import { describe, expect, it } from 'vitest';

import { makeMenuItem } from '../test/factories';
import {
  MAX_QUANTITY_PER_ITEM,
  cartItemCount,
  cartReducer,
  cartSubtotalCents,
  cartTotals,
  emptyCart,
  quantityOf,
  type CartState,
} from './cartReducer';

const pizza = makeMenuItem({ id: 1, name: 'Margherita', price_cents: 1150 });
const burger = makeMenuItem({ id: 2, name: 'Cheeseburger', price_cents: 1090 });

function cartWith(...lines: Array<[typeof pizza, number]>): CartState {
  return { lines: lines.map(([item, quantity]) => ({ item, quantity })) };
}

describe('add', () => {
  it('puts a new item in the cart', () => {
    const state = cartReducer(emptyCart, { type: 'add', item: pizza });

    expect(state.lines).toEqual([{ item: pizza, quantity: 1 }]);
  });

  it('adds the requested quantity', () => {
    const state = cartReducer(emptyCart, { type: 'add', item: pizza, quantity: 3 });

    expect(state.lines[0].quantity).toBe(3);
  });

  it('merges a repeat addition into the existing line', () => {
    // The API rejects duplicate lines for one dish, and two identical rows
    // would be confusing anyway.
    let state = cartReducer(emptyCart, { type: 'add', item: pizza, quantity: 2 });
    state = cartReducer(state, { type: 'add', item: pizza, quantity: 3 });

    expect(state.lines).toHaveLength(1);
    expect(state.lines[0].quantity).toBe(5);
  });

  it('keeps different items on separate lines', () => {
    let state = cartReducer(emptyCart, { type: 'add', item: pizza });
    state = cartReducer(state, { type: 'add', item: burger });

    expect(state.lines.map((line) => line.item.id)).toEqual([1, 2]);
  });

  it('preserves the order items were added in', () => {
    let state = cartReducer(emptyCart, { type: 'add', item: burger });
    state = cartReducer(state, { type: 'add', item: pizza });
    state = cartReducer(state, { type: 'add', item: burger });

    expect(state.lines.map((line) => line.item.id)).toEqual([2, 1]);
  });

  it('caps a merge at the per-item maximum', () => {
    let state = cartReducer(emptyCart, { type: 'add', item: pizza, quantity: 18 });
    state = cartReducer(state, { type: 'add', item: pizza, quantity: 10 });

    expect(state.lines[0].quantity).toBe(MAX_QUANTITY_PER_ITEM);
  });

  it('ignores an addition of zero', () => {
    const state = cartReducer(emptyCart, { type: 'add', item: pizza, quantity: 0 });

    expect(state.lines).toHaveLength(0);
  });

  it('ignores a negative quantity rather than subtracting', () => {
    const state = cartReducer(emptyCart, { type: 'add', item: pizza, quantity: -5 });

    expect(state.lines).toHaveLength(0);
  });

  it('rounds a fractional quantity down to a whole number', () => {
    // The API only accepts integers, so a bad value must not travel.
    const state = cartReducer(emptyCart, { type: 'add', item: pizza, quantity: 2.7 });

    expect(state.lines[0].quantity).toBe(2);
  });
});

describe('setQuantity', () => {
  it('replaces the quantity of a line', () => {
    const state = cartReducer(cartWith([pizza, 2]), {
      type: 'setQuantity',
      itemId: 1,
      quantity: 7,
    });

    expect(state.lines[0].quantity).toBe(7);
  });

  it('removes the line when set to zero', () => {
    const state = cartReducer(cartWith([pizza, 2]), {
      type: 'setQuantity',
      itemId: 1,
      quantity: 0,
    });

    expect(state.lines).toHaveLength(0);
  });

  it('clamps above the maximum', () => {
    const state = cartReducer(cartWith([pizza, 2]), {
      type: 'setQuantity',
      itemId: 1,
      quantity: 999,
    });

    expect(state.lines[0].quantity).toBe(MAX_QUANTITY_PER_ITEM);
  });

  it('leaves other lines untouched', () => {
    const state = cartReducer(cartWith([pizza, 2], [burger, 3]), {
      type: 'setQuantity',
      itemId: 1,
      quantity: 5,
    });

    expect(quantityOf(state.lines, 2)).toBe(3);
  });
});

describe('increment and decrement', () => {
  it('increments a line', () => {
    const state = cartReducer(cartWith([pizza, 2]), { type: 'increment', itemId: 1 });

    expect(state.lines[0].quantity).toBe(3);
  });

  it('decrements a line', () => {
    const state = cartReducer(cartWith([pizza, 2]), { type: 'decrement', itemId: 1 });

    expect(state.lines[0].quantity).toBe(1);
  });

  it('removes the line when decremented from one', () => {
    const state = cartReducer(cartWith([pizza, 1]), { type: 'decrement', itemId: 1 });

    expect(state.lines).toHaveLength(0);
  });

  it('will not increment past the maximum', () => {
    const state = cartReducer(cartWith([pizza, MAX_QUANTITY_PER_ITEM]), {
      type: 'increment',
      itemId: 1,
    });

    expect(state.lines[0].quantity).toBe(MAX_QUANTITY_PER_ITEM);
  });

  it('ignores an unknown item id', () => {
    const before = cartWith([pizza, 2]);

    expect(cartReducer(before, { type: 'increment', itemId: 99 })).toBe(before);
    expect(cartReducer(before, { type: 'decrement', itemId: 99 })).toBe(before);
  });
});

describe('remove and clear', () => {
  it('removes one line', () => {
    const state = cartReducer(cartWith([pizza, 2], [burger, 1]), { type: 'remove', itemId: 1 });

    expect(state.lines.map((line) => line.item.id)).toEqual([2]);
  });

  it('empties the whole cart', () => {
    const state = cartReducer(cartWith([pizza, 2], [burger, 1]), { type: 'clear' });

    expect(state.lines).toHaveLength(0);
  });
});

describe('derived totals', () => {
  it('sums line totals into a subtotal', () => {
    expect(cartSubtotalCents(cartWith([pizza, 2], [burger, 1]).lines)).toBe(1150 * 2 + 1090);
  });

  it('counts units rather than lines', () => {
    expect(cartItemCount(cartWith([pizza, 2], [burger, 3]).lines)).toBe(5);
  });

  it('charges delivery below the free threshold', () => {
    const totals = cartTotals(cartWith([pizza, 1]).lines);

    expect(totals.subtotalCents).toBe(1150);
    expect(totals.deliveryFeeCents).toBe(299);
    expect(totals.totalCents).toBe(1449);
  });

  it('waives delivery above the free threshold', () => {
    const totals = cartTotals(cartWith([pizza, 3]).lines);

    expect(totals.subtotalCents).toBe(3450);
    expect(totals.deliveryFeeCents).toBe(0);
    expect(totals.totalCents).toBe(3450);
  });

  it('charges nothing at all for an empty cart', () => {
    // Showing a delivery fee on an empty cart would be nonsense.
    expect(cartTotals([])).toEqual({
      subtotalCents: 0,
      deliveryFeeCents: 0,
      totalCents: 0,
      itemCount: 0,
    });
  });

  it('reports zero for an item that is not in the cart', () => {
    expect(quantityOf(cartWith([pizza, 2]).lines, 99)).toBe(0);
  });
});

describe('immutability', () => {
  it('never mutates the state it was given', () => {
    const before = cartWith([pizza, 2]);
    const snapshot = structuredClone(before);

    cartReducer(before, { type: 'add', item: pizza, quantity: 3 });
    cartReducer(before, { type: 'remove', itemId: 1 });
    cartReducer(before, { type: 'increment', itemId: 1 });

    expect(before).toEqual(snapshot);
  });
});
