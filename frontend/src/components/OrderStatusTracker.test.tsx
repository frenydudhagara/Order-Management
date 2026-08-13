/** The status timeline. */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { makeOrder } from '../test/factories';
import { STATUS_FLOW, type OrderStatus } from '../types';
import { OrderStatusTracker } from './OrderStatusTracker';

function renderTracker(status: OrderStatus) {
  render(<OrderStatusTracker order={makeOrder({ status })} />);
}

function stageState(stageTestId: string): string | null {
  return screen.getByTestId(stageTestId).getAttribute('data-state');
}

describe('stages', () => {
  it('shows every stage up front, including ones still to come', () => {
    // Seeing what is still ahead is the point of a progress tracker.
    renderTracker('Order Received');

    for (const stage of STATUS_FLOW) {
      expect(screen.getByText(stage)).toBeInTheDocument();
    }
  });

  it('marks the first stage as current for a new order', () => {
    renderTracker('Order Received');

    expect(stageState('stage-order-received')).toBe('current');
    expect(stageState('stage-preparing')).toBe('pending');
    expect(stageState('stage-delivered')).toBe('pending');
  });

  it('marks earlier stages complete as the order progresses', () => {
    renderTracker('Out for Delivery');

    expect(stageState('stage-order-received')).toBe('complete');
    expect(stageState('stage-preparing')).toBe('complete');
    expect(stageState('stage-out-for-delivery')).toBe('current');
    expect(stageState('stage-delivered')).toBe('pending');
  });

  it('marks every stage complete or current once delivered', () => {
    renderTracker('Delivered');

    expect(stageState('stage-out-for-delivery')).toBe('complete');
    expect(stageState('stage-delivered')).toBe('current');
  });

  it('flags the current stage for assistive technology', () => {
    renderTracker('Preparing');

    expect(screen.getByTestId('stage-preparing')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByTestId('stage-delivered')).not.toHaveAttribute('aria-current');
  });
});

describe('timestamps', () => {
  it('shows the time a stage was reached', () => {
    const order = makeOrder({
      status: 'Preparing',
      events: [
        { status: 'Order Received', note: '', created_at: '2026-08-12T16:00:00Z' },
        { status: 'Preparing', note: '', created_at: '2026-08-12T16:05:00Z' },
      ],
    });

    render(<OrderStatusTracker order={order} />);

    // Rendered in the browser's locale, so assert on the timeline structure
    // rather than an exact string.
    const received = screen.getByTestId('stage-order-received');
    expect(received.textContent).toMatch(/\d{1,2}:\d{2}/);
  });

  it('shows no timestamp for a stage that has not happened yet', () => {
    render(<OrderStatusTracker order={makeOrder({ status: 'Order Received' })} />);

    expect(screen.getByTestId('stage-delivered').textContent).not.toMatch(/\d{1,2}:\d{2}/);
  });
});

describe('cancellation', () => {
  it('replaces the timeline with a cancellation notice', () => {
    // A half-filled progress bar would imply the order is still coming.
    render(<OrderStatusTracker order={makeOrder({ status: 'Cancelled' })} />);

    expect(screen.getByTestId('status-tracker')).toHaveAttribute('data-state', 'cancelled');
    expect(screen.getByText(/order cancelled/i)).toBeInTheDocument();
    expect(screen.queryByTestId('stage-preparing')).not.toBeInTheDocument();
  });

  it('mentions when it was cancelled if the event is present', () => {
    const order = makeOrder({
      status: 'Cancelled',
      events: [
        { status: 'Order Received', note: '', created_at: '2026-08-12T16:00:00Z' },
        { status: 'Cancelled', note: '', created_at: '2026-08-12T16:03:00Z' },
      ],
    });

    render(<OrderStatusTracker order={order} />);

    expect(screen.getByText(/will not be delivered/i).textContent).toMatch(/\d{1,2}:\d{2}/);
  });

  it('still reads the status out to assistive technology', () => {
    render(<OrderStatusTracker order={makeOrder({ status: 'Cancelled' })} />);

    expect(screen.getByRole('status')).toHaveTextContent('Order status: Cancelled');
  });
});

describe('announcements', () => {
  it('exposes the current status in a live region', () => {
    render(<OrderStatusTracker order={makeOrder({ status: 'Out for Delivery' })} />);

    const announcement = screen.getByRole('status');
    expect(announcement).toHaveTextContent('Order status: Out for Delivery');
    expect(announcement).toHaveAttribute('aria-live', 'polite');
  });

  it('names the progress list', () => {
    render(<OrderStatusTracker order={makeOrder()} />);

    expect(screen.getByRole('list', { name: /order progress/i })).toBeInTheDocument();
  });
});
