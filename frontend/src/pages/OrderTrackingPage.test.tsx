/**
 * The tracking page, wired to a fake WebSocket.
 *
 * This is the test that proves the real-time requirement end to end: a status
 * pushed by the server has to move the timeline on screen without a reload.
 */

import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeErrorBody, makeOrder } from '../test/factories';
import {
  FakeWebSocket,
  installFakeWebSocket,
  jsonResponder,
  renderWithProviders,
} from '../test/helpers';
import type { OrderStatus } from '../types';
import { OrderTrackingPage } from './OrderTrackingPage';

const ORDER_ID = '11111111-2222-4333-8444-555555555555';

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  installFakeWebSocket();
  fetchMock = vi.fn(jsonResponder(makeOrder()));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  FakeWebSocket.reset();
});

function renderTracking() {
  renderWithProviders(
    <Routes>
      <Route path="/orders/:orderId" element={<OrderTrackingPage />} />
    </Routes>,
    { route: `/orders/${ORDER_ID}` },
  );
}

function socket(): FakeWebSocket {
  const instance = FakeWebSocket.latest;
  if (!instance) throw new Error('the page did not open a WebSocket');
  return instance;
}

function push(status: OrderStatus) {
  act(() =>
    socket().simulateMessage({
      type: 'order.status_changed',
      order_id: ORDER_ID,
      data: makeOrder({ status }),
    }),
  );
}

describe('rendering an order', () => {
  it('shows the status, items and delivery details', async () => {
    renderTracking();

    expect(await screen.findByTestId('status-badge-order-received')).toBeInTheDocument();
    expect(screen.getByText('Priya Sharma')).toBeInTheDocument();
    expect(screen.getByText(/42 Wallaby Way/)).toBeInTheDocument();
    expect(screen.getByText(/Margherita Pizza/)).toBeInTheDocument();
  });

  it('shows the money breakdown', async () => {
    renderTracking();
    await screen.findByTestId('status-tracker');

    const section = screen.getByRole('heading', { name: /your order/i }).closest('section');
    const summary = within(section as HTMLElement);

    // 2 x $11.50 appears twice, as the line total and as the subtotal, and
    // being under $25 means the $2.99 delivery fee applies.
    expect(summary.getAllByText('$23.00')).toHaveLength(2);
    expect(summary.getByText('$2.99')).toBeInTheDocument();
    expect(summary.getByText('$25.99')).toBeInTheDocument();
  });

  it('shows a loading state before the order arrives', () => {
    renderTracking();

    expect(screen.getByRole('status')).toHaveTextContent(/loading your order/i);
  });

  it('shows a headline matching the current status', async () => {
    renderTracking();

    expect(await screen.findByRole('heading', { name: /order received/i })).toBeInTheDocument();
  });

  it('shows delivery notes when the customer left some', async () => {
    fetchMock.mockImplementation(jsonResponder(makeOrder({ notes: 'Leave at the door' })));
    renderTracking();

    expect(await screen.findByText(/leave at the door/i)).toBeInTheDocument();
  });
});

describe('live updates', () => {
  it('advances the timeline when the server pushes a new status', async () => {
    renderTracking();
    await screen.findByTestId('status-tracker');
    act(() => socket().simulateOpen());

    push('Preparing');

    await waitFor(() =>
      expect(screen.getByTestId('stage-preparing')).toHaveAttribute('data-state', 'current'),
    );
    expect(screen.getByTestId('stage-order-received')).toHaveAttribute('data-state', 'complete');
  });

  it('updates the headline and badge together', async () => {
    renderTracking();
    await screen.findByTestId('status-tracker');
    act(() => socket().simulateOpen());

    push('Out for Delivery');

    expect(await screen.findByRole('heading', { name: /on its way to you/i })).toBeInTheDocument();
    expect(screen.getByTestId('status-badge-out-for-delivery')).toBeInTheDocument();
  });

  it('walks the whole way to delivered without a reload', async () => {
    renderTracking();
    await screen.findByTestId('status-tracker');
    act(() => socket().simulateOpen());

    push('Preparing');
    await screen.findByRole('heading', { name: /being prepared/i });
    push('Out for Delivery');
    await screen.findByRole('heading', { name: /on its way/i });
    push('Delivered');

    expect(await screen.findByRole('heading', { name: /delivered/i })).toBeInTheDocument();
    expect(screen.getByTestId('stage-delivered')).toHaveAttribute('data-state', 'current');
  });

  it('swaps the timeline for a cancellation notice when cancelled', async () => {
    renderTracking();
    await screen.findByTestId('status-tracker');
    act(() => socket().simulateOpen());

    push('Cancelled');

    await waitFor(() =>
      expect(screen.getByTestId('status-tracker')).toHaveAttribute('data-state', 'cancelled'),
    );
  });

  it('shows a live badge while the socket is connected', async () => {
    renderTracking();
    await screen.findByTestId('status-tracker');

    act(() => socket().simulateOpen());

    await waitFor(() =>
      expect(screen.getByTestId('live-indicator')).toHaveAttribute('data-state', 'live'),
    );
  });

  it('tells the customer when it has fallen back to auto-refreshing', async () => {
    // Updates lag by a few seconds in this mode, so saying so beats letting
    // the page look stuck.
    renderTracking();
    await screen.findByTestId('status-tracker');

    act(() => socket().simulateClose(1006));

    await waitFor(() =>
      expect(screen.getByTestId('live-indicator')).toHaveAttribute('data-state', 'polling'),
    );
    expect(screen.getByTestId('live-indicator')).toHaveTextContent(/auto-refreshing/i);
  });
});

describe('unknown order', () => {
  it('explains that the order could not be found', async () => {
    fetchMock.mockImplementation(
      jsonResponder(makeErrorBody('order_not_found', 'No order found'), 404),
    );
    renderTracking();

    expect(await screen.findByText(/could not find that order/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to the menu/i })).toBeInTheDocument();
  });

  it('treats the dedicated socket close code as not-found too', async () => {
    renderTracking();
    await screen.findByTestId('status-tracker');

    act(() => socket().simulateClose(4404));

    expect(await screen.findByText(/could not find that order/i)).toBeInTheDocument();
  });
});

describe('demo controls', () => {
  it('offers the next status in the flow', async () => {
    renderTracking();
    await screen.findByTestId('status-tracker');

    expect(
      await screen.findByRole('button', { name: /advance to .*preparing/i }),
    ).toBeInTheDocument();
  });

  it('patches the status when advancing', async () => {
    renderTracking();
    await screen.findByTestId('status-tracker');
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /advance to .*preparing/i }));

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        ([, options]) => (options as RequestInit)?.method === 'PATCH',
      );
      expect(patch?.[0]).toBe(`/api/orders/${ORDER_ID}/status`);
      expect(JSON.parse((patch?.[1] as RequestInit).body as string)).toMatchObject({
        status: 'Preparing',
      });
    });
  });

  it('cancels via DELETE', async () => {
    renderTracking();
    await screen.findByTestId('status-tracker');
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /cancel order/i }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([, options]) => (options as RequestInit)?.method === 'DELETE'),
      ).toBe(true),
    );
  });

  it('surfaces a refused transition rather than failing silently', async () => {
    renderTracking();
    await screen.findByTestId('status-tracker');
    const user = userEvent.setup();

    fetchMock.mockImplementation((_url: string, options: RequestInit) =>
      options?.method === 'PATCH'
        ? Promise.resolve(
            new Response(
              JSON.stringify(
                makeErrorBody('invalid_status_transition', 'Cannot change order status'),
              ),
              { status: 409, headers: { 'Content-Type': 'application/json' } },
            ),
          )
        : jsonResponder(makeOrder())(),
    );

    await user.click(screen.getByRole('button', { name: /advance to/i }));

    expect(await screen.findByText(/cannot change order status/i)).toBeInTheDocument();
  });

  it('hides the controls once the order is finished', async () => {
    // Nothing can be advanced or cancelled from a terminal state.
    fetchMock.mockImplementation(jsonResponder(makeOrder({ status: 'Delivered' })));
    renderTracking();
    await screen.findByTestId('status-tracker');

    expect(screen.queryByRole('button', { name: /advance to/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /cancel order/i })).not.toBeInTheDocument();
  });

  it('does not offer cancellation once the rider has it', async () => {
    fetchMock.mockImplementation(jsonResponder(makeOrder({ status: 'Out for Delivery' })));
    renderTracking();
    await screen.findByTestId('status-tracker');

    expect(screen.queryByRole('button', { name: /cancel order/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /advance to .*delivered/i })).toBeInTheDocument();
  });
});

describe('history', () => {
  it('lists the status events', async () => {
    fetchMock.mockImplementation(
      jsonResponder(
        makeOrder({
          status: 'Preparing',
          events: [
            { status: 'Order Received', note: '', created_at: '2026-08-12T16:00:00Z' },
            { status: 'Preparing', note: '', created_at: '2026-08-12T16:05:00Z' },
          ],
        }),
      ),
    );
    renderTracking();

    const history = await screen.findByRole('heading', { name: /history/i });
    const section = history.closest('section');
    expect(section).not.toBeNull();
    expect(within(section as HTMLElement).getByText(/Order Received/)).toBeInTheDocument();
  });
});
