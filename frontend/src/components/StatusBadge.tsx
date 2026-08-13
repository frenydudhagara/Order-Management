/** Coloured pill for an order status. */

import { slugify } from '../lib/format';
import type { OrderStatus } from '../types';

const STYLES: Record<OrderStatus, string> = {
  'Order Received': 'bg-sky-100 text-sky-800 ring-sky-200',
  Preparing: 'bg-amber-100 text-amber-900 ring-amber-200',
  'Out for Delivery': 'bg-violet-100 text-violet-800 ring-violet-200',
  Delivered: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
  Cancelled: 'bg-stone-200 text-stone-700 ring-stone-300',
};

interface StatusBadgeProps {
  status: OrderStatus;
  className?: string;
}

export function StatusBadge({ status, className = '' }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset ${STYLES[status]} ${className}`}
      data-testid={`status-badge-${slugify(status)}`}
    >
      {status}
    </span>
  );
}
