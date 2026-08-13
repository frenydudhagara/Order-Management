/**
 * Checkout, end to end through the cart provider.
 *
 * The cart is pre-seeded via localStorage, which is the same path a returning
 * customer takes.
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CART_STORAGE_KEY, ORDER_IDS_STORAGE_KEY } from '../lib/storageKeys';
import { makeErrorBody, makeMenuItem, makeOrder } from '../test/factories';
import { jsonResponse, renderWithProviders } from '../test/helpers';
import { CheckoutPage } from './CheckoutPage';

const PIZZA = makeMenuItem({ id: 1, name: 'Margherita Pizza', price_cents: 1150 });

let fetchMock: ReturnType<typeof vi.fn>;

function seedCart(quantity = 2) {
  window.localStorage.setItem(
    CART_STORAGE_KEY,
    JSON.stringify({ lines: [{ item: PIZZA, quantity }] }),
  );
}

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(jsonResponse(makeOrder(), 201));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/full name/i), 'Priya Sharma');
  await user.type(screen.getByLabelText(/phone number/i), '+44 20 7946 0958');
  await user.type(
    screen.getByLabelText(/delivery address/i),
    '42 Wallaby Way, Sydney NSW 2000',
  );
  await user.click(screen.getByRole('button', { name: /place order/i }));
}

describe('with an empty cart', () => {
  it('offers a route back to the menu instead of an unusable form', () => {
    renderWithProviders(<CheckoutPage />);

    expect(screen.getByText(/your cart is empty/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /browse the menu/i })).toBeInTheDocument();
    expect(screen.queryByTestId('checkout-form')).not.toBeInTheDocument();
  });
});

describe('with items in the cart', () => {
  beforeEach(() => seedCart());

  it('shows the order summary with the server-matching total', () => {
    renderWithProviders(<CheckoutPage />);

    // 2 x 1150 = 2300, under the 2500 threshold, so 299 delivery applies.
    expect(screen.getByTestId('cart-total')).toHaveTextContent('$25.99');
  });

  it('shows the delivery details form', () => {
    renderWithProviders(<CheckoutPage />);

    expect(screen.getByTestId('checkout-form')).toBeInTheDocument();
  });

  it('sends only menu ids and quantities, never prices', async () => {
    // The server prices the order; letting the client send money would be a
    // way to buy a pizza for a cent.
    renderWithProviders(<CheckoutPage />);
    const user = userEvent.setup();

    await fillAndSubmit(user);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, options] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    const body = JSON.parse(options.body as string);

    expect(body.items).toEqual([{ menu_item_id: 1, quantity: 2 }]);
    expect(JSON.stringify(body)).not.toMatch(/price|total/i);
  });

  it('posts the delivery details', async () => {
    renderWithProviders(<CheckoutPage />);
    const user = userEvent.setup();

    await fillAndSubmit(user);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, options] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    expect(url).toBe('/api/orders');
    expect(JSON.parse(options.body as string)).toMatchObject({
      customer_name: 'Priya Sharma',
      phone: '+44 20 7946 0958',
      address: '42 Wallaby Way, Sydney NSW 2000',
    });
  });

  it('does not call the API when the form is invalid', async () => {
    renderWithProviders(<CheckoutPage />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /place order/i }));

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('after a successful order', () => {
  beforeEach(() => seedCart());

  it('remembers the order id for this browser', async () => {
    // There is no login, so "my orders" is whatever the browser stored.
    const order = makeOrder({ id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' });
    fetchMock.mockResolvedValue(jsonResponse(order, 201));
    renderWithProviders(<CheckoutPage />);
    const user = userEvent.setup();

    await fillAndSubmit(user);

    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem(ORDER_IDS_STORAGE_KEY) ?? '[]');
      expect(stored).toContain(order.id);
    });
  });

  it('empties the cart', async () => {
    renderWithProviders(<CheckoutPage />);
    const user = userEvent.setup();

    await fillAndSubmit(user);

    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem(CART_STORAGE_KEY) ?? '{}');
      expect(stored.lines).toEqual([]);
    });
  });
});

describe('when the order fails', () => {
  beforeEach(() => seedCart());

  it('shows the server message', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(makeErrorBody('rate_limit_exceeded', 'Too many requests.'), 429),
    );
    renderWithProviders(<CheckoutPage />);
    const user = userEvent.setup();

    await fillAndSubmit(user);

    expect(await screen.findByText(/too many requests/i)).toBeInTheDocument();
  });

  it('attaches server field errors to the right inputs', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        makeErrorBody('validation_error', 'The submitted data is invalid.', {
          fields: { phone: 'Phone number must contain between 7 and 15 digits' },
        }),
        422,
      ),
    );
    renderWithProviders(<CheckoutPage />);
    const user = userEvent.setup();

    await fillAndSubmit(user);

    expect(await screen.findByText(/between 7 and 15 digits/i)).toBeInTheDocument();
  });

  it('explains what to do when a dish is no longer available', async () => {
    // A generic "not found" would leave the customer stuck on this page.
    fetchMock.mockResolvedValue(
      jsonResponse(makeErrorBody('menu_item_not_found', 'Menu item(s) not found: 1'), 404),
    );
    renderWithProviders(<CheckoutPage />);
    const user = userEvent.setup();

    await fillAndSubmit(user);

    expect(await screen.findByText(/no longer available/i)).toBeInTheDocument();
    expect(screen.getByText(/remove it and try again/i)).toBeInTheDocument();
  });

  it('reports a network failure in plain language', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    renderWithProviders(<CheckoutPage />);
    const user = userEvent.setup();

    await fillAndSubmit(user);

    expect(await screen.findByText(/could not reach the server/i)).toBeInTheDocument();
  });

  it('keeps the cart so the customer can retry', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    renderWithProviders(<CheckoutPage />);
    const user = userEvent.setup();

    await fillAndSubmit(user);
    await screen.findByText(/could not reach the server/i);

    expect(screen.getByTestId('cart-total')).toHaveTextContent('$25.99');
  });

  it('re-enables the submit button after a failure', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    renderWithProviders(<CheckoutPage />);
    const user = userEvent.setup();

    await fillAndSubmit(user);
    await screen.findByText(/could not reach the server/i);

    expect(screen.getByRole('button', { name: /place order/i })).toBeEnabled();
  });
});
