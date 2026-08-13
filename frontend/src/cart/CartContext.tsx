/**
 * Cart context: the reducer plus persistence and a small action API.
 *
 * Context rather than a state library because the cart is the only shared
 * client state in the app; adding Redux or Zustand here would be ceremony
 * without payoff.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react';

import type { CartLine, MenuItem } from '../types';
import { readJson, writeJson } from '../lib/storage';
import { CART_STORAGE_KEY } from '../lib/storageKeys';
import {
  cartReducer,
  cartTotals,
  emptyCart,
  quantityOf,
  type CartState,
  type CartTotals,
} from './cartReducer';

interface CartContextValue {
  lines: CartLine[];
  totals: CartTotals;
  isEmpty: boolean;
  quantityFor: (itemId: number) => number;
  add: (item: MenuItem, quantity?: number) => void;
  setQuantity: (itemId: number, quantity: number) => void;
  increment: (itemId: number) => void;
  decrement: (itemId: number) => void;
  remove: (itemId: number) => void;
  clear: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

/**
 * Rebuild cart state from storage, discarding anything malformed.
 *
 * A stored cart outlives deploys, so its shape cannot be trusted -- an old
 * entry missing `price_cents` would otherwise produce a `NaN` total.
 */
function loadPersistedCart(): CartState {
  const stored = readJson<unknown>(CART_STORAGE_KEY, null);
  if (!stored || typeof stored !== 'object' || !Array.isArray((stored as CartState).lines)) {
    return emptyCart;
  }

  const lines = (stored as CartState).lines.filter(
    (line): line is CartLine =>
      Boolean(line?.item) &&
      typeof line.item.id === 'number' &&
      typeof line.item.price_cents === 'number' &&
      typeof line.quantity === 'number' &&
      line.quantity > 0,
  );

  return { lines };
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(cartReducer, undefined, loadPersistedCart);

  useEffect(() => {
    writeJson(CART_STORAGE_KEY, state);
  }, [state]);

  const add = useCallback((item: MenuItem, quantity = 1) => {
    dispatch({ type: 'add', item, quantity });
  }, []);

  const setQuantity = useCallback((itemId: number, quantity: number) => {
    dispatch({ type: 'setQuantity', itemId, quantity });
  }, []);

  const increment = useCallback((itemId: number) => {
    dispatch({ type: 'increment', itemId });
  }, []);

  const decrement = useCallback((itemId: number) => {
    dispatch({ type: 'decrement', itemId });
  }, []);

  const remove = useCallback((itemId: number) => {
    dispatch({ type: 'remove', itemId });
  }, []);

  const clear = useCallback(() => {
    dispatch({ type: 'clear' });
  }, []);

  const value = useMemo<CartContextValue>(
    () => ({
      lines: state.lines,
      totals: cartTotals(state.lines),
      isEmpty: state.lines.length === 0,
      quantityFor: (itemId: number) => quantityOf(state.lines, itemId),
      add,
      setQuantity,
      increment,
      decrement,
      remove,
      clear,
    }),
    [state.lines, add, setQuantity, increment, decrement, remove, clear],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

/**
 * Access the cart.
 *
 * Co-located with the provider so the context object stays private to this
 * module. That trips the fast-refresh lint rule, which wants a file to export
 * components only; splitting them would mean exporting the context itself, so
 * the trade is worse. Editing this file just does a full reload in dev.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useCart(): CartContextValue {
  const context = useContext(CartContext);
  if (context === null) {
    throw new Error('useCart must be used inside a <CartProvider>');
  }
  return context;
}
