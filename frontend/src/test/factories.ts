/**
 * Test data builders.
 *
 * Each returns a complete, valid object with sensible defaults so a test only
 * has to state the field it actually cares about.
 */

import type { MenuItem, Order, OrderItem, OrderStatus, OrderSummary } from '../types';

let nextId = 1;

export function makeMenuItem(overrides: Partial<MenuItem> = {}): MenuItem {
  const id = overrides.id ?? nextId++;
  const priceCents = overrides.price_cents ?? 1150;
  return {
    id,
    name: `Test Dish ${id}`,
    description: 'A very tasty test dish with a description long enough to wrap.',
    price_cents: priceCents,
    price: priceCents / 100,
    image_url: `https://images.example.com/dish-${id}.jpg`,
    category: 'Pizza',
    is_available: true,
    ...overrides,
  };
}

export function makeOrderItem(overrides: Partial<OrderItem> = {}): OrderItem {
  const unitPrice = overrides.unit_price_cents ?? 1150;
  const quantity = overrides.quantity ?? 1;
  return {
    menu_item_id: 1,
    name: 'Margherita Pizza',
    unit_price_cents: unitPrice,
    quantity,
    image_url: 'https://images.example.com/pizza.jpg',
    line_total_cents: unitPrice * quantity,
    ...overrides,
  };
}

const PROGRESSION: Record<OrderStatus, OrderStatus | null> = {
  'Order Received': 'Preparing',
  Preparing: 'Out for Delivery',
  'Out for Delivery': 'Delivered',
  Delivered: null,
  Cancelled: null,
};

export function makeOrder(overrides: Partial<Order> = {}): Order {
  const status = overrides.status ?? 'Order Received';
  const items = overrides.items ?? [makeOrderItem({ quantity: 2 })];
  const subtotal =
    overrides.subtotal_cents ?? items.reduce((sum, item) => sum + item.line_total_cents, 0);
  const deliveryFee = overrides.delivery_fee_cents ?? (subtotal >= 2500 ? 0 : 299);
  const createdAt = overrides.created_at ?? '2026-08-12T16:00:00Z';

  return {
    id: '11111111-2222-4333-8444-555555555555',
    status,
    next_status: PROGRESSION[status],
    customer_name: 'Priya Sharma',
    phone: '+44 20 7946 0958',
    address: '42 Wallaby Way, Sydney NSW 2000',
    notes: '',
    subtotal_cents: subtotal,
    delivery_fee_cents: deliveryFee,
    total_cents: subtotal + deliveryFee,
    created_at: createdAt,
    updated_at: createdAt,
    items,
    events: [
      {
        status: 'Order Received',
        note: 'We have your order.',
        created_at: createdAt,
      },
    ],
    ...overrides,
  };
}

export function makeOrderSummary(overrides: Partial<OrderSummary> = {}): OrderSummary {
  return {
    id: '11111111-2222-4333-8444-555555555555',
    status: 'Preparing',
    total_cents: 2599,
    created_at: '2026-08-12T16:00:00Z',
    item_count: 2,
    ...overrides,
  };
}

/** Backend error envelope, for testing how the client surfaces failures. */
export function makeErrorBody(
  code: string,
  message: string,
  details: Record<string, unknown> = {},
) {
  return { error: { code, message, details } };
}
