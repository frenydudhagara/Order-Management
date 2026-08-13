/** The per-browser order history list. */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ORDER_IDS_STORAGE_KEY } from '../lib/storageKeys';
import { makeErrorBody, makeOrderSummary } from '../test/factories';
import { jsonResponder, renderWithProviders } from '../test/helpers';
import { OrdersPage } from './OrdersPage';

const ID_A = 'aaaaaaaa-1111-4111-8111-111111111111';
const ID_B = 'bbbbbbbb-2222-4222-8222-222222222222';

let fetchMock: ReturnType<typeof vi.fn>;

function rememberIds(...ids: string[]) {
  window.localStorage.setItem(ORDER_IDS_STORAGE_KEY, JSON.stringify(ids));
}

beforeEach(() => {
  fetchMock = vi.fn(jsonResponder([]));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe('with no stored orders', () => {
  it('invites the customer to order, without calling the API', async () => {
    renderWithProviders(<OrdersPage />);

    expect(await screen.findByText(/you have not ordered yet/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('with stored orders', () => {
  beforeEach(() => rememberIds(ID_A, ID_B));

  it('fetches exactly the stored ids in one request', async () => {
    // Only ids are kept locally; the API stays the source of truth for status.
    fetchMock.mockImplementation(jsonResponder([makeOrderSummary({ id: ID_A })]));

    renderWithProviders(<OrdersPage />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/orders?ids=${ID_A}%2C${ID_B}`);
  });

  it('lists each order with its status and total', async () => {
    fetchMock.mockImplementation(
      jsonResponder([
        makeOrderSummary({ id: ID_A, status: 'Preparing', total_cents: 2599, item_count: 2 }),
        makeOrderSummary({ id: ID_B, status: 'Delivered', total_cents: 1449, item_count: 1 }),
      ]),
    );

    renderWithProviders(<OrdersPage />);

    expect(await screen.findByText(/2 items · \$25\.99/)).toBeInTheDocument();
    expect(screen.getByText(/1 item · \$14\.49/)).toBeInTheDocument();
    expect(screen.getByTestId('status-badge-preparing')).toBeInTheDocument();
    expect(screen.getByTestId('status-badge-delivered')).toBeInTheDocument();
  });

  it('links each order to its tracking page', async () => {
    fetchMock.mockImplementation(jsonResponder([makeOrderSummary({ id: ID_A })]));

    renderWithProviders(<OrdersPage />);

    const link = await screen.findByRole('link', { name: /\$25\.99/ });
    expect(link).toHaveAttribute('href', `/orders/${ID_A}`);
  });

  it('explains the gap when the server no longer has the stored orders', async () => {
    fetchMock.mockImplementation(jsonResponder([]));

    renderWithProviders(<OrdersPage />);

    expect(await screen.findByText(/no orders to show/i)).toBeInTheDocument();
    expect(screen.getByText(/could not be found on the server/i)).toBeInTheDocument();
  });

  it('shows an error with a retry when the request fails', async () => {
    fetchMock.mockImplementation(jsonResponder(makeErrorBody('http_error', 'Service down'), 503));

    renderWithProviders(<OrdersPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/service down/i);
  });

  it('clears the stored history on request', async () => {
    fetchMock.mockImplementation(jsonResponder([makeOrderSummary({ id: ID_A })]));
    renderWithProviders(<OrdersPage />);
    await screen.findByText(/\$25\.99/);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /clear history/i }));

    expect(await screen.findByText(/you have not ordered yet/i)).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(ORDER_IDS_STORAGE_KEY) ?? '[]')).toEqual([]);
  });
});

describe('resilience', () => {
  it('ignores malformed stored data', async () => {
    window.localStorage.setItem(ORDER_IDS_STORAGE_KEY, 'not json');

    renderWithProviders(<OrdersPage />);

    expect(await screen.findByText(/you have not ordered yet/i)).toBeInTheDocument();
  });

  it('ignores stored entries that are not ids', async () => {
    window.localStorage.setItem(ORDER_IDS_STORAGE_KEY, JSON.stringify([42, null, ID_A]));
    fetchMock.mockImplementation(jsonResponder([makeOrderSummary({ id: ID_A })]));

    renderWithProviders(<OrdersPage />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/orders?ids=${ID_A}`);
  });
});
