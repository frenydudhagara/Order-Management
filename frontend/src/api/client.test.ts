/** The API client: request shape, and how failures become typed errors. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeErrorBody, makeMenuItem, makeOrder } from '../test/factories';
import { jsonResponse } from '../test/helpers';
import { ApiError, NetworkError, api } from './client';

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function lastCall(): [string, RequestInit] {
  return fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [string, RequestInit];
}

/**
 * Await a request expected to fail and return its ApiError.
 *
 * Catching inline would give a union of the error and the resolved value, so
 * the assertions below could not see the error's own fields.
 */
async function expectApiError(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (cause) {
    expect(cause).toBeInstanceOf(ApiError);
    return cause as ApiError;
  }
  throw new Error('expected the request to fail, but it resolved');
}

describe('requests', () => {
  it('fetches the menu from the API path', async () => {
    fetchMock.mockResolvedValue(jsonResponse([makeMenuItem()]));

    const items = await api.getMenu();

    expect(lastCall()[0]).toBe('/api/menu');
    expect(items).toHaveLength(1);
  });

  it('passes menu filters as query parameters', async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));

    await api.getMenu({ category: 'Pizza', search: 'truffle' });

    expect(lastCall()[0]).toBe('/api/menu?category=Pizza&search=truffle');
  });

  it('omits empty filters instead of sending blank parameters', async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));

    await api.getMenu({ category: '', search: undefined });

    expect(lastCall()[0]).toBe('/api/menu');
  });

  it('posts an order as JSON', async () => {
    fetchMock.mockResolvedValue(jsonResponse(makeOrder(), 201));

    await api.createOrder({
      customer_name: 'Priya Sharma',
      phone: '+44 20 7946 0958',
      address: '42 Wallaby Way, Sydney NSW 2000',
      notes: '',
      items: [{ menu_item_id: 1, quantity: 2 }],
    });

    const [url, options] = lastCall();
    expect(url).toBe('/api/orders');
    expect(options.method).toBe('POST');
    expect(options.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(options.body as string).items).toEqual([{ menu_item_id: 1, quantity: 2 }]);
  });

  it('sends no content-type header on a GET, which has no body', () => {
    fetchMock.mockResolvedValue(jsonResponse([]));

    void api.getMenu();

    expect(lastCall()[1].headers).toBeUndefined();
  });

  it('escapes an order id in the path', async () => {
    fetchMock.mockResolvedValue(jsonResponse(makeOrder()));

    await api.getOrder('a b/c');

    expect(lastCall()[0]).toBe('/api/orders/a%20b%2Fc');
  });

  it('joins order ids into one request rather than making several', async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));

    await api.getOrderSummaries(['id-1', 'id-2']);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lastCall()[0]).toBe('/api/orders?ids=id-1%2Cid-2');
  });

  it('does not call the network for an empty id list', async () => {
    const result = await api.getOrderSummaries([]);

    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('patches a status update', async () => {
    fetchMock.mockResolvedValue(jsonResponse(makeOrder({ status: 'Preparing' })));

    await api.updateOrderStatus('order-1', 'Preparing', 'Chef started');

    const [url, options] = lastCall();
    expect(url).toBe('/api/orders/order-1/status');
    expect(options.method).toBe('PATCH');
    expect(JSON.parse(options.body as string)).toEqual({
      status: 'Preparing',
      note: 'Chef started',
    });
  });

  it('cancels via DELETE', async () => {
    fetchMock.mockResolvedValue(jsonResponse(makeOrder({ status: 'Cancelled' })));

    await api.cancelOrder('order-1');

    expect(lastCall()[1].method).toBe('DELETE');
  });
});

describe('error handling', () => {
  it('raises ApiError carrying the backend code and message', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(makeErrorBody('order_not_found', 'No order found with id x'), 404),
    );

    await expect(api.getOrder('missing')).rejects.toMatchObject({
      name: 'ApiError',
      status: 404,
      code: 'order_not_found',
      message: 'No order found with id x',
    });
  });

  it('exposes per-field validation messages for the form to render', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        makeErrorBody('validation_error', 'The submitted data is invalid.', {
          fields: { phone: 'Phone number must contain between 7 and 15 digits' },
        }),
        422,
      ),
    );

    const error = await expectApiError(
      api.createOrder({
        customer_name: 'X',
        phone: '1',
        address: 'y',
        notes: '',
        items: [],
      }),
    );

    expect(error.isValidation).toBe(true);
    expect(error.fieldErrors.phone).toMatch(/7 and 15 digits/);
  });

  it('treats a 409 as a non-validation error', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(makeErrorBody('invalid_status_transition', 'Cannot change status'), 409),
    );

    const error = await expectApiError(api.updateOrderStatus('order-1', 'Delivered'));

    expect(error.isValidation).toBe(false);
    expect(error.code).toBe('invalid_status_transition');
  });

  it('raises NetworkError when the request never reaches the server', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(api.getMenu()).rejects.toBeInstanceOf(NetworkError);
  });

  it('lets an abort propagate rather than reporting it as a failure', async () => {
    // Cancelling on unmount is intentional and must not surface as an error.
    fetchMock.mockRejectedValue(new DOMException('Aborted', 'AbortError'));

    await expect(api.getMenu()).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('still produces a usable error when the body is not JSON', async () => {
    fetchMock.mockResolvedValue(new Response('<html>502 Bad Gateway</html>', { status: 502 }));

    const error = await expectApiError(api.getMenu());

    expect(error.status).toBe(502);
    expect(error.message).toMatch(/502/);
  });

  it('still produces a usable error when the body is empty', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 500 }));

    const error = await expectApiError(api.getMenu());

    expect(error.code).toBe('unknown_error');
  });

  it('has no field errors when the backend sends none', async () => {
    fetchMock.mockResolvedValue(jsonResponse(makeErrorBody('rate_limit_exceeded', 'Slow'), 429));

    const error = await expectApiError(api.getMenu());

    expect(error.fieldErrors).toEqual({});
  });
});
