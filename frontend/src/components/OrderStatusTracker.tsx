/**
 * The status timeline.
 *
 * Shows all four stages up front so the customer can see what is still to
 * come, with the current one highlighted. A cancelled order gets its own
 * terminal display rather than a half-filled progress bar.
 */

import { formatTime, slugify } from '../lib/format';
import { STATUS_FLOW, type Order, type OrderStatus } from '../types';
import { CheckIcon, ChefIcon, ReceiptIcon, ScooterIcon } from './Icons';

const STAGE_ICONS: Record<string, (props: { className?: string }) => JSX.Element> = {
  'Order Received': ReceiptIcon,
  Preparing: ChefIcon,
  'Out for Delivery': ScooterIcon,
  Delivered: CheckIcon,
};

const STAGE_BLURBS: Record<string, string> = {
  'Order Received': 'Sent to the restaurant',
  Preparing: 'Your food is being cooked',
  'Out for Delivery': 'On the way to you',
  Delivered: 'Enjoy your meal',
};

interface OrderStatusTrackerProps {
  order: Order;
}

export function OrderStatusTracker({ order }: OrderStatusTrackerProps) {
  if (order.status === 'Cancelled') {
    return <CancelledNotice order={order} />;
  }

  const currentIndex = STATUS_FLOW.indexOf(order.status);
  const timestamps = new Map<OrderStatus, string>(
    order.events.map((event) => [event.status, event.created_at]),
  );

  return (
    <div data-testid="status-tracker">
      <ol className="relative space-y-0" aria-label="Order progress">
        {STATUS_FLOW.map((stage, index) => {
          const isComplete = index < currentIndex;
          const isCurrent = index === currentIndex;
          const isPending = index > currentIndex;
          const Icon = STAGE_ICONS[stage] ?? ReceiptIcon;
          const timestamp = timestamps.get(stage);
          const isLast = index === STATUS_FLOW.length - 1;

          return (
            <li
              key={stage}
              className="relative flex gap-4 pb-6 last:pb-0"
              data-testid={`stage-${slugify(stage)}`}
              data-state={isComplete ? 'complete' : isCurrent ? 'current' : 'pending'}
              aria-current={isCurrent ? 'step' : undefined}
            >
              {/* The rail between markers. Drawn per-item so it inherits the
                  completed/pending colour of the step it leads away from. */}
              {!isLast && (
                <span
                  aria-hidden="true"
                  className={`absolute left-5 top-11 h-[calc(100%-2.75rem)] w-0.5 -translate-x-1/2 rounded ${
                    isComplete ? 'bg-brand-500' : 'bg-stone-200'
                  }`}
                />
              )}

              <span className="relative flex h-10 w-10 shrink-0 items-center justify-center">
                {isCurrent && (
                  <span className="absolute inset-0 animate-pulse-ring rounded-full bg-brand-400" />
                )}
                <span
                  className={`relative flex h-10 w-10 items-center justify-center rounded-full border-2 ${
                    isComplete
                      ? 'border-brand-500 bg-brand-500 text-white'
                      : isCurrent
                        ? 'border-brand-500 bg-white text-brand-600'
                        : 'border-stone-200 bg-white text-stone-300'
                  }`}
                >
                  {isComplete ? <CheckIcon className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
                </span>
              </span>

              <div className="min-w-0 pt-1.5">
                <p
                  className={`font-semibold leading-tight ${
                    isPending ? 'text-stone-400' : 'text-stone-900'
                  }`}
                >
                  {stage}
                </p>
                <p className={`text-sm ${isPending ? 'text-stone-400' : 'text-stone-600'}`}>
                  {STAGE_BLURBS[stage]}
                  {timestamp && (
                    <span className="ml-2 tabular-nums text-stone-400">
                      {formatTime(timestamp)}
                    </span>
                  )}
                </p>
              </div>
            </li>
          );
        })}
      </ol>

      {/* Announces each change once, so a screen reader user is told the status
          moved without having to re-read the whole timeline. */}
      <p className="sr-only" role="status" aria-live="polite">
        Order status: {order.status}
      </p>
    </div>
  );
}

function CancelledNotice({ order }: { order: Order }) {
  const cancelledAt = order.events.find((event) => event.status === 'Cancelled')?.created_at;

  return (
    <div
      className="rounded-xl border border-stone-200 bg-stone-50 p-5"
      data-testid="status-tracker"
      data-state="cancelled"
    >
      <p className="font-semibold text-stone-900">Order cancelled</p>
      <p className="mt-1 text-sm text-stone-600">
        This order was cancelled{cancelledAt ? ` at ${formatTime(cancelledAt)}` : ''} and will not
        be delivered.
      </p>
      <p className="sr-only" role="status" aria-live="polite">
        Order status: Cancelled
      </p>
    </div>
  );
}
