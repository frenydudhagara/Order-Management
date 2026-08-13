/** App header with the cart badge and nav. */

import { Link, NavLink } from 'react-router-dom';

import { useCart } from '../cart/CartContext';
import { formatMoney } from '../lib/format';
import { CartIcon, ReceiptIcon } from './Icons';

export function Header() {
  const { totals, isEmpty } = useCart();

  return (
    <header className="sticky top-0 z-20 border-b border-stone-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4">
        <Link
          to="/"
          className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-stone-900"
        >
          <span aria-hidden="true" className="text-2xl">
            🍕
          </span>
          Forkful
        </Link>

        <nav className="ml-auto flex items-center gap-1" aria-label="Main">
          <NavLink
            to="/"
            className={({ isActive }) =>
              `btn-ghost text-sm ${isActive ? 'bg-stone-100 text-stone-900' : ''}`
            }
          >
            Menu
          </NavLink>
          <NavLink
            to="/orders"
            className={({ isActive }) =>
              `btn-ghost text-sm ${isActive ? 'bg-stone-100 text-stone-900' : ''}`
            }
          >
            <ReceiptIcon className="h-4 w-4" />
            My orders
          </NavLink>

          <Link
            to="/checkout"
            className="btn-primary ml-1 px-4 py-2 text-sm"
            aria-label={
              isEmpty
                ? 'Cart is empty'
                : `Cart: ${totals.itemCount} item${totals.itemCount === 1 ? '' : 's'}, ${formatMoney(totals.totalCents)}`
            }
          >
            <CartIcon className="h-4 w-4" />
            <span className="hidden sm:inline">Cart</span>
            {!isEmpty && (
              <span
                className="rounded-full bg-white/25 px-2 py-0.5 text-xs font-bold tabular-nums"
                data-testid="cart-badge"
              >
                {totals.itemCount}
              </span>
            )}
          </Link>
        </nav>
      </div>
    </header>
  );
}
