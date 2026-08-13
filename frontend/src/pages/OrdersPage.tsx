/** Orders this browser has placed. */

import { Link } from 'react-router-dom';

import { EmptyState, ErrorBlock, LoadingBlock } from '../components/Feedback';
import { ReceiptIcon } from '../components/Icons';
import { StatusBadge } from '../components/StatusBadge';
import { formatMoney, formatRelativeTime } from '../lib/format';
import { useOrderHistory } from '../hooks/useOrderHistory';

export function OrdersPage() {
  const { orders, isLoading, error, hasStoredIds, reload, clear } = useOrderHistory();

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-stone-900">My orders</h1>
          <p className="mt-2 text-sm text-stone-600">
            Orders placed in this browser. There is no sign-in, so this list lives on your device.
          </p>
        </div>
        {orders.length > 0 && (
          <button type="button" onClick={clear} className="btn-ghost text-xs text-stone-500">
            Clear history
          </button>
        )}
      </div>

      {isLoading && <LoadingBlock label="Loading your orders…" />}

      {!isLoading && error && <ErrorBlock message={error} onRetry={reload} />}

      {!isLoading && !error && orders.length === 0 && (
        <EmptyState
          icon={<ReceiptIcon className="h-10 w-10" />}
          title={hasStoredIds ? 'No orders to show' : 'You have not ordered yet'}
          message={
            hasStoredIds
              ? 'The orders saved on this device could not be found on the server.'
              : 'Once you place an order it will appear here so you can track it.'
          }
          action={
            <Link to="/" className="btn-primary">
              Browse the menu
            </Link>
          }
        />
      )}

      {orders.length > 0 && (
        <ul className="space-y-3">
          {orders.map((order) => (
            <li key={order.id}>
              <Link
                to={`/orders/${order.id}`}
                className="card flex items-center gap-4 p-4 transition-shadow hover:shadow-md"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-stone-900">
                    {order.item_count} item{order.item_count === 1 ? '' : 's'} ·{' '}
                    {formatMoney(order.total_cents)}
                  </p>
                  <p className="mt-0.5 text-sm text-stone-500">
                    <span className="font-mono">{order.id.slice(0, 8)}</span> ·{' '}
                    {formatRelativeTime(order.created_at)}
                  </p>
                </div>
                <StatusBadge status={order.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
