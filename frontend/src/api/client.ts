/**
 * Typed API client.
 *
 * One place owns request building and error translation, so components never
 * touch `fetch` and never have to interpret a raw response. Backend failures
 * arrive as `ApiError`, which carries the machine-readable code and per-field
 * validation messages the checkout form needs.
 */

import type {
  ApiErrorBody,
  CreateOrderRequest,
  MenuItem,
  Order,
  OrderStatus,
  OrderSummary,
} from '../types';
import { API_BASE_URL } from './config';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** Field name -> message, present on validation failures. */
  readonly fieldErrors: Record<string, string>;
  readonly details: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.fieldErrors = (details.fields as Record<string, string> | undefined) ?? {};
  }

  /** True when the problem is the user's input rather than the request itself. */
  get isValidation(): boolean {
    return this.status === 422 || Object.keys(this.fieldErrors).length > 0;
  }
}

/** Raised when the network never delivered the request. */
export class NetworkError extends Error {
  constructor(message = 'Could not reach the server. Check your connection and try again.') {
    super(message);
    this.name = 'NetworkError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal } = options;

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      signal,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    // An aborted request is a deliberate cancellation, not a failure to report.
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new NetworkError();
  }

  if (response.status === 204) return undefined as T;

  const payload = await readJson(response);

  if (!response.ok) {
    const envelope = payload as ApiErrorBody | null;
    const apiError = envelope?.error;
    throw new ApiError(
      response.status,
      apiError?.code ?? 'unknown_error',
      apiError?.message ?? `Request failed with status ${response.status}.`,
      apiError?.details ?? {},
    );
  }

  return payload as T;
}

/** Parse a JSON body, tolerating an empty or non-JSON response. */
async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const serialised = search.toString();
  return serialised ? `?${serialised}` : '';
}

export const api = {
  getMenu(
    filters: { category?: string; search?: string } = {},
    signal?: AbortSignal,
  ): Promise<MenuItem[]> {
    return request<MenuItem[]>(`/menu${query(filters)}`, { signal });
  },

  getCategories(signal?: AbortSignal): Promise<string[]> {
    return request<string[]>('/menu/categories', { signal });
  },

  createOrder(payload: CreateOrderRequest, signal?: AbortSignal): Promise<Order> {
    return request<Order>('/orders', { method: 'POST', body: payload, signal });
  },

  getOrder(orderId: string, signal?: AbortSignal): Promise<Order> {
    return request<Order>(`/orders/${encodeURIComponent(orderId)}`, { signal });
  },

  getOrderSummaries(orderIds: string[], signal?: AbortSignal): Promise<OrderSummary[]> {
    if (orderIds.length === 0) return Promise.resolve([]);
    return request<OrderSummary[]>(`/orders${query({ ids: orderIds.join(',') })}`, { signal });
  },

  updateOrderStatus(orderId: string, status: OrderStatus, note = ''): Promise<Order> {
    return request<Order>(`/orders/${encodeURIComponent(orderId)}/status`, {
      method: 'PATCH',
      body: { status, note },
    });
  },

  cancelOrder(orderId: string): Promise<Order> {
    return request<Order>(`/orders/${encodeURIComponent(orderId)}`, { method: 'DELETE' });
  },
};
