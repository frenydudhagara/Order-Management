/**
 * Live tracking: WebSocket push, and the fallback to polling when it fails.
 *
 * A fake WebSocket stands in for the real one so the transport behaviour can be
 * driven deterministically instead of depending on a running server.
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeErrorBody, makeOrder } from '../test/factories';
import { FakeWebSocket, installFakeWebSocket, jsonResponder } from '../test/helpers';
import { useOrderTracking } from './useOrderTracking';

const ORDER_ID = '11111111-2222-4333-8444-555555555555';

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  installFakeWebSocket();
  // A responder rather than a fixed response: polling calls this repeatedly,
  // and a Response body can only be read once.
  fetchMock = vi.fn(jsonResponder(makeOrder()));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  FakeWebSocket.reset();
});

function renderTracking(orderId: string = ORDER_ID) {
  return renderHook(() => useOrderTracking(orderId));
}

/**
 * Fake timers that still let real time pass.
 *
 * Testing Library's `waitFor` only knows how to pump Jest's fake timers, so
 * with a frozen vitest clock it would spin forever. `shouldAdvanceTime` keeps
 * the wall clock moving so `waitFor` resolves, while
 * `advanceTimersByTimeAsync` still drives intervals instantly.
 */
function useAdvancingFakeTimers(): void {
  vi.useFakeTimers({ shouldAdvanceTime: true });
}

/** The socket the hook opened, asserted to exist. */
function socket(): FakeWebSocket {
  const instance = FakeWebSocket.latest;
  if (!instance) throw new Error('the hook did not open a WebSocket');
  return instance;
}

describe('initial load', () => {
  it('fetches the order once up front so the page can paint', async () => {
    // The socket may be slow or never connect; the page must not stay blank.
    const { result } = renderTracking();

    await waitFor(() => expect(result.current.order).not.toBeNull());
    expect(result.current.order?.id).toBe(ORDER_ID);
    expect(fetchMock).toHaveBeenCalledWith(`/api/orders/${ORDER_ID}`, expect.anything());
  });

  it('opens a WebSocket for the order', () => {
    renderTracking();

    expect(socket().url).toContain(`/api/ws/orders/${ORDER_ID}`);
  });

  it('reports "connecting" before the socket opens', () => {
    const { result } = renderTracking();

    expect(result.current.connection).toBe('connecting');
  });

  it('does nothing at all without an order id', () => {
    // Called through renderHook directly: passing `undefined` to a parameter
    // with a default would silently use the default instead.
    const { result } = renderHook(() => useOrderTracking(undefined));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(result.current.isLoading).toBe(false);
  });

  it('reports not-found for an order the API does not know', async () => {
    fetchMock.mockImplementation(
      jsonResponder(makeErrorBody('order_not_found', 'No order found'), 404),
    );

    const { result } = renderTracking();

    await waitFor(() => expect(result.current.notFound).toBe(true));
    expect(result.current.isLoading).toBe(false);
  });

  it('surfaces an unexpected server failure as an error', async () => {
    fetchMock.mockImplementation(jsonResponder(makeErrorBody('http_error', 'Boom'), 500));

    const { result } = renderTracking();

    await waitFor(() => expect(result.current.error).toMatch(/boom/i));
  });
});

describe('live updates', () => {
  it('goes live once the socket opens', async () => {
    const { result } = renderTracking();

    act(() => socket().simulateOpen());

    await waitFor(() => expect(result.current.connection).toBe('live'));
  });

  it('applies a pushed status change', async () => {
    const { result } = renderTracking();
    act(() => socket().simulateOpen());

    act(() =>
      socket().simulateMessage({
        type: 'order.status_changed',
        order_id: ORDER_ID,
        data: makeOrder({ status: 'Preparing' }),
      }),
    );

    await waitFor(() => expect(result.current.order?.status).toBe('Preparing'));
  });

  it('applies the snapshot the server sends on connect', async () => {
    const { result } = renderTracking();
    act(() => socket().simulateOpen());

    act(() =>
      socket().simulateMessage({
        type: 'snapshot',
        order_id: ORDER_ID,
        data: makeOrder({ status: 'Out for Delivery' }),
      }),
    );

    await waitFor(() => expect(result.current.order?.status).toBe('Out for Delivery'));
  });

  it('renders from the pushed payload without a follow-up request', async () => {
    // Each message carries the whole order, which is why no refetch is needed.
    const { result } = renderTracking();
    await waitFor(() => expect(result.current.order).not.toBeNull());
    act(() => socket().simulateOpen());
    const callsBefore = fetchMock.mock.calls.length;

    act(() =>
      socket().simulateMessage({
        type: 'order.status_changed',
        order_id: ORDER_ID,
        data: makeOrder({ status: 'Delivered' }),
      }),
    );

    await waitFor(() => expect(result.current.order?.status).toBe('Delivered'));
    expect(fetchMock.mock.calls).toHaveLength(callsBefore);
  });

  it('ignores a pong', async () => {
    const { result } = renderTracking();
    await waitFor(() => expect(result.current.order).not.toBeNull());
    act(() => socket().simulateOpen());

    act(() => socket().simulateMessage({ type: 'pong', order_id: ORDER_ID, data: {} }));

    expect(result.current.order?.status).toBe('Order Received');
  });

  it('ignores an unparseable frame instead of crashing', async () => {
    const { result } = renderTracking();
    await waitFor(() => expect(result.current.order).not.toBeNull());
    act(() => socket().simulateOpen());

    act(() => socket().simulateRawMessage('this is not json'));

    expect(result.current.order?.status).toBe('Order Received');
  });

  it('ignores a well-formed message that is not an order', async () => {
    const { result } = renderTracking();
    await waitFor(() => expect(result.current.order).not.toBeNull());
    act(() => socket().simulateOpen());

    act(() => socket().simulateRawMessage(JSON.stringify({ type: 'weird', data: { x: 1 } })));

    expect(result.current.order?.status).toBe('Order Received');
  });
});

describe('closing on a known order', () => {
  it('reports not-found on the server\'s dedicated close code', async () => {
    // 4404 distinguishes "no such order" from "server unreachable", so the
    // client can stop retrying.
    const { result } = renderTracking();

    act(() => socket().simulateClose(4404));

    await waitFor(() => expect(result.current.notFound).toBe(true));
    expect(result.current.connection).toBe('closed');
  });

  it('does not reconnect once the order is delivered', async () => {
    fetchMock.mockImplementation(jsonResponder(makeOrder({ status: 'Delivered' })));
    const { result } = renderTracking();
    await waitFor(() => expect(result.current.order?.status).toBe('Delivered'));

    act(() => socket().simulateClose(1000));

    await waitFor(() => expect(result.current.connection).toBe('closed'));
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('does not reconnect once the order is cancelled', async () => {
    fetchMock.mockImplementation(jsonResponder(makeOrder({ status: 'Cancelled' })));
    const { result } = renderTracking();
    await waitFor(() => expect(result.current.order?.status).toBe('Cancelled'));

    act(() => socket().simulateClose(1000));

    await waitFor(() => expect(result.current.connection).toBe('closed'));
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});

describe('falling back to polling', () => {
  it('starts polling when the socket drops', async () => {
    const { result } = renderTracking();
    await waitFor(() => expect(result.current.order).not.toBeNull());

    act(() => socket().simulateClose(1006));

    await waitFor(() => expect(result.current.connection).toBe('polling'));
  });

  it('polls the order on an interval', async () => {
    useAdvancingFakeTimers();
    const { result } = renderTracking();
    act(() => socket().simulateClose(1006));
    await waitFor(() => expect(result.current.connection).toBe('polling'));
    const callsBefore = fetchMock.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4100);
    });

    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it('stops polling and goes live again if the socket comes back', async () => {
    useAdvancingFakeTimers();
    const { result } = renderTracking();
    act(() => socket().simulateClose(1006));
    await waitFor(() => expect(result.current.connection).toBe('polling'));

    // Backoff schedules a retry; let it fire and then succeed.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    act(() => socket().simulateOpen());

    await waitFor(() => expect(result.current.connection).toBe('live'));

    const callsAfterLive = fetchMock.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(fetchMock.mock.calls).toHaveLength(callsAfterLive);
  });

  it('gives up on the socket after several attempts and stays on polling', async () => {
    useAdvancingFakeTimers();
    const { result } = renderTracking();

    // Fail every reconnect attempt.
    for (let attempt = 0; attempt < 6; attempt += 1) {
      act(() => socket().simulateClose(1006));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
    }

    expect(result.current.connection).toBe('polling');
    // Backoff caps the number of sockets rather than retrying forever.
    expect(FakeWebSocket.instances.length).toBeLessThanOrEqual(6);
  });

  it('backs off rather than reconnecting immediately', async () => {
    useAdvancingFakeTimers();
    renderTracking();

    act(() => socket().simulateClose(1006));
    expect(FakeWebSocket.instances).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(FakeWebSocket.instances).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('stops polling once a polled response shows the order is finished', async () => {
    useAdvancingFakeTimers();
    const { result } = renderTracking();
    act(() => socket().simulateClose(1006));
    await waitFor(() => expect(result.current.connection).toBe('polling'));

    fetchMock.mockImplementation(jsonResponder(makeOrder({ status: 'Delivered' })));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4100);
    });
    await waitFor(() => expect(result.current.order?.status).toBe('Delivered'));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4100);
    });
    const callsAfterFinished = fetchMock.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    expect(fetchMock.mock.calls).toHaveLength(callsAfterFinished);
    expect(result.current.connection).toBe('closed');
  });

  it('falls back to polling when constructing the socket throws', async () => {
    // e.g. a blocked mixed-content upgrade throws synchronously.
    vi.stubGlobal(
      'WebSocket',
      class {
        constructor() {
          throw new Error('blocked');
        }
      },
    );

    const { result } = renderTracking();

    await waitFor(() => expect(result.current.connection).toBe('polling'));
  });
});

describe('keep-alive', () => {
  it('sends a ping so an idle connection is not closed by a proxy', async () => {
    useAdvancingFakeTimers();
    renderTracking();
    act(() => socket().simulateOpen());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(26_000);
    });

    expect(socket().sent).toContain('ping');
  });
});

describe('cleanup', () => {
  it('closes the socket on unmount', async () => {
    const { unmount } = renderTracking();
    act(() => socket().simulateOpen());
    const instance = socket();

    unmount();

    expect(instance.closed).toBe(true);
  });

  it('stops polling on unmount', async () => {
    useAdvancingFakeTimers();
    const { result, unmount } = renderTracking();
    act(() => socket().simulateClose(1006));
    await waitFor(() => expect(result.current.connection).toBe('polling'));

    unmount();
    const callsAfterUnmount = fetchMock.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    expect(fetchMock.mock.calls).toHaveLength(callsAfterUnmount);
  });

  it('does not reconnect after unmount', async () => {
    useAdvancingFakeTimers();
    const { unmount } = renderTracking();
    act(() => socket().simulateClose(1006));

    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});

describe('manual refresh', () => {
  it('refetches the order on demand', async () => {
    const { result } = renderTracking();
    await waitFor(() => expect(result.current.order).not.toBeNull());
    const callsBefore = fetchMock.mock.calls.length;

    fetchMock.mockImplementation(jsonResponder(makeOrder({ status: 'Preparing' })));
    await act(async () => {
      result.current.refresh();
    });

    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore);
    await waitFor(() => expect(result.current.order?.status).toBe('Preparing'));
  });
});
