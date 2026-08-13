/**
 * Where the API lives.
 *
 * Development: `VITE_API_BASE_URL` is unset, so requests go to `/api` on the
 * dev server's own origin and Vite proxies them to the Python service.
 * Production: the frontend is on Vercel and the API on a separate host, so
 * `VITE_API_BASE_URL` is set to that host's origin at build time.
 */

const RAW_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').trim();

/** Origin of the API, or an empty string when it is same-origin. */
export const API_ORIGIN = RAW_BASE.replace(/\/+$/, '');

export const API_BASE_URL = `${API_ORIGIN}/api`;

/**
 * WebSocket URL for a given order.
 *
 * Derived from the HTTP origin rather than configured separately, so the two
 * can never disagree. `https` must map to `wss`: a plain `ws` connection from
 * an HTTPS page is blocked by the browser as mixed content.
 */
export function orderSocketUrl(orderId: string): string {
  const origin = API_ORIGIN || window.location.origin;
  const wsOrigin = origin.replace(/^http/, 'ws');
  return `${wsOrigin}/api/ws/orders/${orderId}`;
}
