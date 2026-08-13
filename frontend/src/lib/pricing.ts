/**
 * Client-side mirror of the backend's delivery fee rule.
 *
 * Duplicated on purpose: the cart has to show a total before the order exists,
 * and a round trip per quantity tap would make the UI feel sluggish. The server
 * remains the authority -- it recalculates everything at checkout and the order
 * it returns is what gets displayed and charged.
 */

export const DELIVERY_FEE_CENTS = 299;
export const FREE_DELIVERY_THRESHOLD_CENTS = 2500;

export function calculateDeliveryFee(subtotalCents: number): number {
  return subtotalCents >= FREE_DELIVERY_THRESHOLD_CENTS ? 0 : DELIVERY_FEE_CENTS;
}

/** How much more the customer needs to spend for free delivery, in cents. */
export function amountUntilFreeDelivery(subtotalCents: number): number {
  return Math.max(0, FREE_DELIVERY_THRESHOLD_CENTS - subtotalCents);
}
