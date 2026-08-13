/**
 * Types mirroring the backend's response schemas.
 *
 * Money is always integer cents, matching the API. The frontend never does
 * arithmetic on a decimal price.
 */

export const ORDER_STATUSES = [
  'Order Received',
  'Preparing',
  'Out for Delivery',
  'Delivered',
  'Cancelled',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** The statuses an order passes through on the happy path, in order. */
export const STATUS_FLOW: readonly OrderStatus[] = [
  'Order Received',
  'Preparing',
  'Out for Delivery',
  'Delivered',
];

export interface MenuItem {
  id: number;
  name: string;
  description: string;
  price_cents: number;
  price: number;
  image_url: string;
  category: string;
  is_available: boolean;
}

export interface OrderItem {
  menu_item_id: number | null;
  name: string;
  unit_price_cents: number;
  quantity: number;
  image_url: string;
  line_total_cents: number;
}

export interface OrderStatusEvent {
  status: OrderStatus;
  note: string;
  created_at: string;
}

export interface Order {
  id: string;
  status: OrderStatus;
  next_status: OrderStatus | null;
  customer_name: string;
  phone: string;
  address: string;
  notes: string;
  subtotal_cents: number;
  delivery_fee_cents: number;
  total_cents: number;
  created_at: string;
  updated_at: string;
  items: OrderItem[];
  events: OrderStatusEvent[];
}

export interface OrderSummary {
  id: string;
  status: OrderStatus;
  total_cents: number;
  created_at: string;
  item_count: number;
}

export interface DeliveryDetails {
  customer_name: string;
  phone: string;
  address: string;
  notes: string;
}

export interface CreateOrderRequest extends DeliveryDetails {
  items: Array<{ menu_item_id: number; quantity: number }>;
}

/** A cart line: the menu item plus how many were chosen. */
export interface CartLine {
  item: MenuItem;
  quantity: number;
}

/** Shape of the backend's error envelope. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details: {
      fields?: Record<string, string>;
      [key: string]: unknown;
    };
  };
}

export type WebSocketMessage =
  | { type: 'snapshot'; order_id: string; data: Order }
  | { type: 'order.created'; order_id: string; data: Order }
  | { type: 'order.status_changed'; order_id: string; data: Order }
  | { type: 'pong'; order_id: string; data: Record<string, never> };

/** How the tracking view is currently receiving updates. */
export type LiveConnectionState = 'connecting' | 'live' | 'polling' | 'closed';
