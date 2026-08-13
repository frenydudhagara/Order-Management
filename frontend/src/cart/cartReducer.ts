/**
 * Cart state as a pure reducer.
 *
 * Kept free of React so the rules -- merging repeat additions, clamping
 * quantities, removing a line at zero -- can be tested directly, and so the
 * component tree only ever dispatches intent.
 */

import type { CartLine, MenuItem } from '../types';
import { calculateDeliveryFee } from '../lib/pricing';

/** Mirrors the backend's `max_quantity_per_item`; the server enforces it too. */
export const MAX_QUANTITY_PER_ITEM = 20;

export interface CartState {
  lines: CartLine[];
}

export const emptyCart: CartState = { lines: [] };

export type CartAction =
  | { type: 'add'; item: MenuItem; quantity?: number }
  | { type: 'setQuantity'; itemId: number; quantity: number }
  | { type: 'increment'; itemId: number }
  | { type: 'decrement'; itemId: number }
  | { type: 'remove'; itemId: number }
  | { type: 'clear' }
  | { type: 'replace'; lines: CartLine[] };

function clamp(quantity: number): number {
  // Fractional quantities would be rejected by the API, so round here rather
  // than let a bad value travel.
  const whole = Math.floor(quantity);
  if (whole < 0) return 0;
  return Math.min(whole, MAX_QUANTITY_PER_ITEM);
}

/** Set a line's quantity, dropping the line entirely when it reaches zero. */
function withQuantity(lines: CartLine[], itemId: number, quantity: number): CartLine[] {
  const clamped = clamp(quantity);
  if (clamped === 0) return lines.filter((line) => line.item.id !== itemId);
  return lines.map((line) => (line.item.id === itemId ? { ...line, quantity: clamped } : line));
}

export function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case 'add': {
      const quantity = clamp(action.quantity ?? 1);
      if (quantity === 0) return state;

      const existing = state.lines.find((line) => line.item.id === action.item.id);
      if (existing) {
        // Adding the same dish twice bumps the existing line: the API rejects
        // duplicate lines, and two identical rows in the cart is bad UX anyway.
        return {
          lines: withQuantity(state.lines, action.item.id, existing.quantity + quantity),
        };
      }
      return { lines: [...state.lines, { item: action.item, quantity }] };
    }

    case 'setQuantity':
      return { lines: withQuantity(state.lines, action.itemId, action.quantity) };

    case 'increment': {
      const line = state.lines.find((entry) => entry.item.id === action.itemId);
      if (!line) return state;
      return { lines: withQuantity(state.lines, action.itemId, line.quantity + 1) };
    }

    case 'decrement': {
      const line = state.lines.find((entry) => entry.item.id === action.itemId);
      if (!line) return state;
      return { lines: withQuantity(state.lines, action.itemId, line.quantity - 1) };
    }

    case 'remove':
      return { lines: state.lines.filter((line) => line.item.id !== action.itemId) };

    case 'clear':
      return emptyCart;

    case 'replace':
      return { lines: action.lines };

    default:
      return state;
  }
}

// -- derived values ------------------------------------------------------

export function cartSubtotalCents(lines: CartLine[]): number {
  return lines.reduce((total, line) => total + line.item.price_cents * line.quantity, 0);
}

/** Total units in the cart, which is what the header badge shows. */
export function cartItemCount(lines: CartLine[]): number {
  return lines.reduce((total, line) => total + line.quantity, 0);
}

export function quantityOf(lines: CartLine[], itemId: number): number {
  return lines.find((line) => line.item.id === itemId)?.quantity ?? 0;
}

export interface CartTotals {
  subtotalCents: number;
  deliveryFeeCents: number;
  totalCents: number;
  itemCount: number;
}

/**
 * The totals shown in the UI.
 *
 * A preview only: the server recomputes all of it at checkout, and its answer
 * is what the customer is charged.
 */
export function cartTotals(lines: CartLine[]): CartTotals {
  const subtotalCents = cartSubtotalCents(lines);
  const deliveryFeeCents = lines.length === 0 ? 0 : calculateDeliveryFee(subtotalCents);
  return {
    subtotalCents,
    deliveryFeeCents,
    totalCents: subtotalCents + deliveryFeeCents,
    itemCount: cartItemCount(lines),
  };
}
