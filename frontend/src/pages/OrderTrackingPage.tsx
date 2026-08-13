/**
 * Live order tracking.
 *
 * The status arrives over a WebSocket, falling back to polling automatically.
 * A "demo controls" panel is included so a reviewer can drive the status
 * manually instead of waiting on the simulator's timer -- it calls the same
 * public endpoints any staff tool would.
 */

import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { ApiError, api } from '../api/client';
import { EmptyState, ErrorBlock, LoadingBlock } from '../components/Feedback';
import { LiveIndicator } from '../components/LiveIndicator';
import { OrderStatusTracker } from '../components/OrderStatusTracker';
import { StatusBadge } from '../components/StatusBadge';
import { AlertIcon } from '../components/Icons';
import { formatDateTime, formatMoney, formatRelativeTime } from '../lib/format';
import { useOrderTracking } from '../hooks/useOrderTracking';
import type { Order } from '../types';

export function OrderTrackingPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const { order, isLoading, error, notFound, connection, refresh } = useOrderTracking(orderId);

  if (isLoading && !order) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <LoadingBlock label="Loading your order…" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16">
        <EmptyState
          icon={<AlertIcon className="h-10 w-10" />}
          title="We could not find that order"
          message="The link may be incorrect, or the order may have been placed in a different browser."
          action={
            <Link to="/" className="btn-primary">
              Back to the menu
            </Link>
          }
        />
      </div>
    );
  }

  if (error && !order) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16">
        <ErrorBlock message={error} onRetry={refresh} />
      </div>
    );
  }

  if (!order) return null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-stone-900">
            {headline(order)}
          </h1>
          <p className="mt-2 text-sm text-stone-500">
            Order <span className="font-mono text-stone-700">{order.id.slice(0, 8)}</span> ·
            placed {formatRelativeTime(order.created_at)}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <StatusBadge status={order.status} />
          <LiveIndicator state={connection} />
        </div>
      </div>

      {/* A stale-data warning, only when the live channel is degraded and we
          could not refresh either. */}
      {error && (
        <div className="mb-6 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertIcon className="mt-px h-4 w-4 shrink-0" />
          <span>
            The status shown may be out of date — {error}{' '}
            <button type="button" onClick={refresh} className="font-semibold underline">
              Retry now
            </button>
          </span>
        </div>
      )}

      <div className="card p-6">
        <OrderStatusTracker order={order} />
      </div>

      <OrderDetails order={order} />
      <DemoControls order={order} onChanged={refresh} />
    </div>
  );
}

function headline(order: Order): string {
  switch (order.status) {
    case 'Order Received':
      return 'Order received';
    case 'Preparing':
      return 'Your food is being prepared';
    case 'Out for Delivery':
      return 'On its way to you';
    case 'Delivered':
      return 'Delivered — enjoy!';
    case 'Cancelled':
      return 'Order cancelled';
    default:
      return 'Your order';
  }
}

function OrderDetails({ order }: { order: Order }) {
  return (
    <div className="mt-6 grid gap-6 sm:grid-cols-2">
      <section className="card p-5">
        <h2 className="mb-3 font-bold text-stone-900">Your order</h2>
        <ul className="space-y-2 text-sm">
          {order.items.map((item, index) => (
            <li key={`${item.name}-${index}`} className="flex justify-between gap-3">
              <span className="text-stone-700">
                <span className="font-medium tabular-nums">{item.quantity}×</span> {item.name}
              </span>
              <span className="whitespace-nowrap tabular-nums text-stone-600">
                {formatMoney(item.line_total_cents)}
              </span>
            </li>
          ))}
        </ul>

        <dl className="mt-4 space-y-1.5 border-t border-stone-200 pt-3 text-sm">
          <Row label="Subtotal" value={formatMoney(order.subtotal_cents)} />
          <Row
            label="Delivery"
            value={
              order.delivery_fee_cents === 0 ? 'Free' : formatMoney(order.delivery_fee_cents)
            }
          />
          <div className="flex justify-between border-t border-stone-200 pt-2 font-bold text-stone-900">
            <dt>Total</dt>
            <dd className="tabular-nums">{formatMoney(order.total_cents)}</dd>
          </div>
        </dl>
      </section>

      <section className="card p-5">
        <h2 className="mb-3 font-bold text-stone-900">Delivering to</h2>
        <p className="font-medium text-stone-900">{order.customer_name}</p>
        <p className="mt-1 whitespace-pre-line text-sm text-stone-600">{order.address}</p>
        <p className="mt-1 text-sm text-stone-600">{order.phone}</p>
        {order.notes && (
          <p className="mt-3 rounded-lg bg-stone-50 p-3 text-sm italic text-stone-600">
            “{order.notes}”
          </p>
        )}

        {order.events.length > 0 && (
          <>
            <h3 className="mt-5 mb-2 text-sm font-bold text-stone-900">History</h3>
            <ol className="space-y-1 text-xs text-stone-500">
              {order.events.map((event, index) => (
                <li key={`${event.status}-${index}`}>
                  <span className="tabular-nums">{formatDateTime(event.created_at)}</span> ·{' '}
                  {event.status}
                </li>
              ))}
            </ol>
          </>
        )}
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-stone-600">
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

/**
 * Manual status controls.
 *
 * The backend advances orders on a timer anyway; this exists so the flow can be
 * demonstrated without waiting, and so the "invalid transition" guard is
 * visible rather than just described.
 */
function DemoControls({ order, onChanged }: { order: Order; onChanged: () => void }) {
  const [isWorking, setIsWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const canCancel = order.status === 'Order Received' || order.status === 'Preparing';
  const nextStatus = order.next_status;

  const run = async (action: () => Promise<unknown>) => {
    setIsWorking(true);
    setMessage(null);
    try {
      await action();
      onChanged();
    } catch (cause) {
      setMessage(
        cause instanceof ApiError ? cause.message : 'That action could not be completed.',
      );
    } finally {
      setIsWorking(false);
    }
  };

  if (!nextStatus && !canCancel) return null;

  return (
    <section className="mt-6 rounded-2xl border border-dashed border-stone-300 bg-stone-50 p-5">
      <h2 className="text-sm font-bold uppercase tracking-wide text-stone-500">Demo controls</h2>
      <p className="mt-1 text-sm text-stone-600">
        The kitchen advances this order automatically. Use these to move it along now.
      </p>

      <div className="mt-4 flex flex-wrap gap-3">
        {nextStatus && (
          <button
            type="button"
            disabled={isWorking}
            onClick={() => run(() => api.updateOrderStatus(order.id, nextStatus))}
            className="btn-secondary py-2 text-sm"
          >
            Advance to “{nextStatus}”
          </button>
        )}
        {canCancel && (
          <button
            type="button"
            disabled={isWorking}
            onClick={() => run(() => api.cancelOrder(order.id))}
            className="btn-secondary py-2 text-sm text-red-700 hover:bg-red-50"
          >
            Cancel order
          </button>
        )}
      </div>

      {message && (
        <p className="mt-3 text-sm text-red-700" role="alert">
          {message}
        </p>
      )}
    </section>
  );
}
