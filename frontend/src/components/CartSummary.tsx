/**
 * The cart contents and money breakdown.
 *
 * Used both in the menu sidebar and on the checkout page, so it takes no
 * layout opinion of its own beyond filling its container.
 */

import { Link } from 'react-router-dom';

import { useCart } from '../cart/CartContext';
import { formatMoney } from '../lib/format';
import { amountUntilFreeDelivery } from '../lib/pricing';
import { CartIcon, MinusIcon, PlusIcon, TrashIcon } from './Icons';

interface CartSummaryProps {
  /** Hide the per-line steppers, e.g. on the checkout review panel. */
  readOnly?: boolean;
  showCheckoutButton?: boolean;
}

export function CartSummary({ readOnly = false, showCheckoutButton = true }: CartSummaryProps) {
  const { lines, totals, isEmpty, increment, decrement, remove, clear } = useCart();

  if (isEmpty) {
    return (
      <div className="p-6 text-center" data-testid="cart-empty">
        <CartIcon className="mx-auto h-8 w-8 text-stone-300" />
        <p className="mt-3 font-medium text-stone-800">Your cart is empty</p>
        <p className="mt-1 text-sm text-stone-500">Add a dish from the menu to get started.</p>
      </div>
    );
  }

  const shortfall = amountUntilFreeDelivery(totals.subtotalCents);

  return (
    <div data-testid="cart-summary">
      <ul className="divide-y divide-stone-100">
        {lines.map(({ item, quantity }) => (
          <li key={item.id} className="flex gap-3 p-4" data-testid={`cart-line-${item.id}`}>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-stone-900">{item.name}</p>
              <p className="mt-0.5 text-sm text-stone-500">
                {formatMoney(item.price_cents)} each
              </p>

              {readOnly ? (
                <p className="mt-1 text-sm text-stone-600">Quantity: {quantity}</p>
              ) : (
                <div className="mt-2 flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => decrement(item.id)}
                    className="btn-ghost rounded-full border border-stone-200 p-1.5"
                    aria-label={
                      quantity === 1 ? `Remove ${item.name} from cart` : `Decrease ${item.name}`
                    }
                  >
                    <MinusIcon className="h-3.5 w-3.5" />
                  </button>
                  <span className="min-w-8 text-center text-sm font-semibold tabular-nums">
                    {quantity}
                  </span>
                  <button
                    type="button"
                    onClick={() => increment(item.id)}
                    className="btn-ghost rounded-full border border-stone-200 p-1.5"
                    aria-label={`Increase ${item.name}`}
                  >
                    <PlusIcon className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(item.id)}
                    className="btn-ghost ml-1 rounded-full p-1.5 text-stone-400 hover:text-red-600"
                    aria-label={`Remove ${item.name} from cart`}
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>

            <p className="whitespace-nowrap font-semibold tabular-nums text-stone-900">
              {formatMoney(item.price_cents * quantity)}
            </p>
          </li>
        ))}
      </ul>

      <div className="space-y-2 border-t border-stone-200 p-4 text-sm">
        <Row label="Subtotal" value={formatMoney(totals.subtotalCents)} />
        <Row
          label="Delivery"
          value={totals.deliveryFeeCents === 0 ? 'Free' : formatMoney(totals.deliveryFeeCents)}
          valueClassName={totals.deliveryFeeCents === 0 ? 'text-emerald-700' : undefined}
        />

        {shortfall > 0 && (
          <p className="rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-800">
            Add {formatMoney(shortfall)} more for free delivery.
          </p>
        )}

        <div className="flex items-baseline justify-between border-t border-stone-200 pt-3 text-base font-bold text-stone-900">
          <span>Total</span>
          <span className="tabular-nums" data-testid="cart-total">
            {formatMoney(totals.totalCents)}
          </span>
        </div>

        {showCheckoutButton && (
          <Link to="/checkout" className="btn-primary mt-2 w-full">
            Checkout · {formatMoney(totals.totalCents)}
          </Link>
        )}

        {!readOnly && (
          <button
            type="button"
            onClick={clear}
            className="btn-ghost w-full justify-center text-xs text-stone-500"
          >
            Clear cart
          </button>
        )}
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  valueClassName = '',
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="flex items-baseline justify-between text-stone-600">
      <span>{label}</span>
      <span className={`tabular-nums font-medium text-stone-900 ${valueClassName}`}>{value}</span>
    </div>
  );
}
