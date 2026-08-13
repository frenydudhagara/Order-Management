/**
 * localStorage keys, versioned.
 *
 * The `.v1` suffix means a future change to a stored shape can use a new key
 * rather than trying to migrate whatever an old deploy left behind.
 */

export const CART_STORAGE_KEY = 'forkful.cart.v1';
export const ORDER_IDS_STORAGE_KEY = 'forkful.orderIds.v1';
