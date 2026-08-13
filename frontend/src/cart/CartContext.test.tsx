/** Cart context: persistence, recovery from bad stored data, and the hook guard. */

import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { CART_STORAGE_KEY } from '../lib/storageKeys';
import { makeMenuItem } from '../test/factories';
import { CartProvider, useCart } from './CartContext';

const pizza = makeMenuItem({ id: 1, name: 'Margherita', price_cents: 1150 });

function renderCart() {
  return renderHook(() => useCart(), { wrapper: CartProvider });
}

describe('useCart', () => {
  it('throws a helpful error when used outside the provider', () => {
    expect(() => renderHook(() => useCart())).toThrowError(/CartProvider/);
  });

  it('starts empty', () => {
    const { result } = renderCart();

    expect(result.current.isEmpty).toBe(true);
    expect(result.current.totals.itemCount).toBe(0);
  });

  it('exposes the quantity of a given item', () => {
    const { result } = renderCart();

    act(() => result.current.add(pizza, 2));

    expect(result.current.quantityFor(pizza.id)).toBe(2);
    expect(result.current.quantityFor(999)).toBe(0);
  });

  it('recalculates totals as the cart changes', () => {
    const { result } = renderCart();

    act(() => result.current.add(pizza, 1));
    expect(result.current.totals.totalCents).toBe(1150 + 299);

    act(() => result.current.increment(pizza.id));
    act(() => result.current.increment(pizza.id));
    expect(result.current.totals.subtotalCents).toBe(3450);
    expect(result.current.totals.deliveryFeeCents).toBe(0);
  });
});

describe('persistence', () => {
  it('writes the cart to localStorage', () => {
    const { result } = renderCart();

    act(() => result.current.add(pizza, 2));

    const stored = JSON.parse(window.localStorage.getItem(CART_STORAGE_KEY) ?? '{}');
    expect(stored.lines[0].quantity).toBe(2);
  });

  it('restores a cart saved by a previous visit', () => {
    window.localStorage.setItem(
      CART_STORAGE_KEY,
      JSON.stringify({ lines: [{ item: pizza, quantity: 3 }] }),
    );

    const { result } = renderCart();

    expect(result.current.totals.itemCount).toBe(3);
  });

  it('survives malformed stored data', () => {
    window.localStorage.setItem(CART_STORAGE_KEY, 'not json at all');

    const { result } = renderCart();

    expect(result.current.isEmpty).toBe(true);
  });

  it('survives stored data with the wrong shape', () => {
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify({ lines: 'nope' }));

    const { result } = renderCart();

    expect(result.current.isEmpty).toBe(true);
  });

  it('drops stored lines missing a price so totals cannot become NaN', () => {
    // A cart persisted by an older build could be missing fields.
    window.localStorage.setItem(
      CART_STORAGE_KEY,
      JSON.stringify({
        lines: [
          { item: { id: 7, name: 'Legacy dish' }, quantity: 2 },
          { item: pizza, quantity: 1 },
        ],
      }),
    );

    const { result } = renderCart();

    expect(result.current.lines).toHaveLength(1);
    expect(Number.isNaN(result.current.totals.totalCents)).toBe(false);
    expect(result.current.totals.subtotalCents).toBe(1150);
  });

  it('drops stored lines with a non-positive quantity', () => {
    window.localStorage.setItem(
      CART_STORAGE_KEY,
      JSON.stringify({ lines: [{ item: pizza, quantity: 0 }] }),
    );

    const { result } = renderCart();

    expect(result.current.isEmpty).toBe(true);
  });
});

describe('through the UI', () => {
  function CartProbe() {
    const { add, remove, clear, totals, lines } = useCart();
    return (
      <div>
        <button onClick={() => add(pizza)}>Add pizza</button>
        <button onClick={() => remove(pizza.id)}>Remove pizza</button>
        <button onClick={clear}>Clear</button>
        <p data-testid="count">{totals.itemCount}</p>
        <p data-testid="lines">{lines.length}</p>
      </div>
    );
  }

  it('updates every consumer when the cart changes', async () => {
    const user = userEvent.setup();
    render(
      <CartProvider>
        <CartProbe />
      </CartProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Add pizza' }));
    await user.click(screen.getByRole('button', { name: 'Add pizza' }));

    expect(screen.getByTestId('count')).toHaveTextContent('2');
    expect(screen.getByTestId('lines')).toHaveTextContent('1');

    await user.click(screen.getByRole('button', { name: 'Clear' }));

    expect(screen.getByTestId('count')).toHaveTextContent('0');
  });
});
