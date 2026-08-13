/**
 * One dish on the menu.
 *
 * Two states: "Add" before anything is in the cart, and a quantity stepper
 * once it is. Swapping in place keeps the customer on the menu instead of
 * bouncing them to the cart to change a number.
 */

import { useState } from 'react';

import { MAX_QUANTITY_PER_ITEM } from '../cart/cartReducer';
import { formatMoney } from '../lib/format';
import type { MenuItem } from '../types';
import { MinusIcon, PlusIcon } from './Icons';

interface MenuItemCardProps {
  item: MenuItem;
  quantity: number;
  onAdd: (item: MenuItem) => void;
  onIncrement: (itemId: number) => void;
  onDecrement: (itemId: number) => void;
}

export function MenuItemCard({
  item,
  quantity,
  onAdd,
  onIncrement,
  onDecrement,
}: MenuItemCardProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const inCart = quantity > 0;
  const atMaximum = quantity >= MAX_QUANTITY_PER_ITEM;

  return (
    <article
      className="card group flex flex-col overflow-hidden transition-shadow hover:shadow-md"
      data-testid={`menu-item-${item.id}`}
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-stone-100">
        {imageFailed ? (
          // Images are hotlinked from a CDN, so a failure is a normal case to
          // design for rather than an exception.
          <div
            className="flex h-full w-full items-center justify-center text-4xl"
            role="img"
            aria-label={`${item.name} (image unavailable)`}
          >
            🍽️
          </div>
        ) : (
          <img
            src={item.image_url}
            alt={item.name}
            loading="lazy"
            decoding="async"
            onError={() => setImageFailed(true)}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        )}
        {inCart && (
          <span
            className="absolute right-3 top-3 rounded-full bg-brand-600 px-2.5 py-1 text-xs font-bold text-white shadow"
            data-testid={`in-cart-badge-${item.id}`}
          >
            {quantity} in cart
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-semibold leading-tight text-stone-900">{item.name}</h3>
          <span className="whitespace-nowrap font-semibold text-stone-900">
            {formatMoney(item.price_cents)}
          </span>
        </div>

        <p className="mt-1.5 flex-1 text-sm leading-relaxed text-stone-600">{item.description}</p>

        <div className="mt-4">
          {inCart ? (
            <div
              className="flex items-center justify-between rounded-full border border-stone-300 p-1"
              data-testid={`stepper-${item.id}`}
            >
              <button
                type="button"
                onClick={() => onDecrement(item.id)}
                className="btn-ghost rounded-full p-2"
                aria-label={
                  quantity === 1 ? `Remove ${item.name} from cart` : `Decrease ${item.name}`
                }
              >
                <MinusIcon className="h-4 w-4" />
              </button>

              {/* The live region announces quantity changes to screen readers,
                  which would otherwise be silent. */}
              <span
                className="min-w-8 text-center font-semibold tabular-nums"
                aria-live="polite"
                aria-atomic="true"
              >
                <span className="sr-only">{item.name} quantity: </span>
                {quantity}
              </span>

              <button
                type="button"
                onClick={() => onIncrement(item.id)}
                disabled={atMaximum}
                className="btn-ghost rounded-full p-2"
                aria-label={`Increase ${item.name}`}
                title={atMaximum ? `Maximum ${MAX_QUANTITY_PER_ITEM} per item` : undefined}
              >
                <PlusIcon className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => onAdd(item)}
              className="btn-primary w-full py-2.5"
              aria-label={`Add ${item.name} to cart`}
            >
              <PlusIcon className="h-4 w-4" />
              Add to cart
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
