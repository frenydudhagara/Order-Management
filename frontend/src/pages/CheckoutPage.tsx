/**
 * Checkout: review the cart, enter delivery details, place the order.
 *
 * On success the cart is cleared, the order id is remembered for this browser,
 * and the customer is sent straight to tracking -- the moment after paying is
 * exactly when they want to see the status.
 */

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { ApiError, api } from '../api/client';
import { useCart } from '../cart/CartContext';
import { CartSummary } from '../components/CartSummary';
import { EmptyState, ErrorBlock } from '../components/Feedback';
import { CartIcon } from '../components/Icons';
import { CheckoutForm } from '../components/CheckoutForm';
import { rememberOrderId } from '../hooks/useOrderHistory';
import type { DeliveryDetails } from '../types';

export function CheckoutPage() {
  const { lines, isEmpty, clear } = useCart();
  const navigate = useNavigate();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const handleSubmit = async (details: DeliveryDetails) => {
    setIsSubmitting(true);
    setFormError(null);
    setFieldErrors({});

    try {
      const order = await api.createOrder({
        ...details,
        items: lines.map((line) => ({
          menu_item_id: line.item.id,
          quantity: line.quantity,
        })),
      });

      rememberOrderId(order.id);
      clear();
      navigate(`/orders/${order.id}`, { replace: true });
    } catch (cause) {
      if (cause instanceof ApiError) {
        setFieldErrors(cause.fieldErrors);
        // A menu item that vanished mid-session needs a different instruction
        // than a mistyped phone number.
        setFormError(
          cause.code === 'menu_item_not_found'
            ? 'One of the dishes in your cart is no longer available. Please remove it and try again.'
            : cause.message,
        );
      } else {
        setFormError(
          cause instanceof Error ? cause.message : 'Could not place your order. Please try again.',
        );
      }
      setIsSubmitting(false);
    }
  };

  if (isEmpty) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16">
        <EmptyState
          icon={<CartIcon className="h-10 w-10" />}
          title="Your cart is empty"
          message="Add something from the menu and come back to check out."
          action={
            <Link to="/" className="btn-primary">
              Browse the menu
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-3xl font-extrabold tracking-tight text-stone-900">Checkout</h1>
      <p className="mt-2 text-stone-600">
        Almost there. Tell us where to bring it, and we will start cooking.
      </p>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_22rem]">
        <div className="card p-6">
          <h2 className="mb-6 text-lg font-bold text-stone-900">Delivery details</h2>

          {formError && (
            <div className="mb-6">
              <ErrorBlock title="Could not place your order" message={formError} />
            </div>
          )}

          <CheckoutForm
            onSubmit={handleSubmit}
            isSubmitting={isSubmitting}
            serverFieldErrors={fieldErrors}
          />

          <p className="mt-4 text-center text-xs text-stone-500">
            No payment is taken — this is a demo of the order management flow.
          </p>
        </div>

        <aside className="lg:sticky lg:top-24 lg:h-fit">
          <div className="card overflow-hidden">
            <h2 className="border-b border-stone-200 px-4 py-3 font-bold text-stone-900">
              Order summary
            </h2>
            <CartSummary showCheckoutButton={false} />
          </div>
        </aside>
      </div>
    </div>
  );
}
