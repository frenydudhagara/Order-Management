/** The menu page, driven through the real cart provider. */

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeErrorBody, makeMenuItem } from '../test/factories';
import { jsonResponder, jsonResponse, renderWithProviders } from '../test/helpers';
import { MenuPage } from './MenuPage';

const PIZZA = makeMenuItem({
  id: 1,
  name: 'Margherita Pizza',
  category: 'Pizza',
  price_cents: 1150,
  description: 'Sourdough base with tomato and basil.',
});
const BURGER = makeMenuItem({
  id: 2,
  name: 'Classic Cheeseburger',
  category: 'Burgers',
  price_cents: 1090,
  description: 'Aged beef with melted cheddar.',
});
const LEMONADE = makeMenuItem({
  id: 3,
  name: 'Fresh Lemonade',
  category: 'Drinks',
  price_cents: 350,
  description: 'Cold-pressed lemons and mint.',
});

const MENU = [PIZZA, BURGER, LEMONADE];
const CATEGORIES = ['Burgers', 'Drinks', 'Pizza'];

let fetchMock: ReturnType<typeof vi.fn>;

function stubMenuApi(items = MENU, categories = CATEGORIES) {
  fetchMock = vi.fn((url: string) => {
    if (url.includes('/menu/categories')) return Promise.resolve(jsonResponse(categories));
    if (url.includes('/menu')) return Promise.resolve(jsonResponse(items));
    return Promise.reject(new Error(`unexpected request: ${url}`));
  });
  vi.stubGlobal('fetch', fetchMock);
}

beforeEach(() => stubMenuApi());
afterEach(() => vi.unstubAllGlobals());

async function renderMenu() {
  renderWithProviders(<MenuPage />);
  await waitFor(() => expect(screen.getByText('Margherita Pizza')).toBeInTheDocument());
  return userEvent.setup();
}

describe('loading the menu', () => {
  it('shows a skeleton while loading', () => {
    renderWithProviders(<MenuPage />);

    expect(screen.getByTestId('menu-skeleton')).toBeInTheDocument();
  });

  it('renders every dish with its price', async () => {
    await renderMenu();

    expect(screen.getByText('Margherita Pizza')).toBeInTheDocument();
    expect(screen.getByText('$11.50')).toBeInTheDocument();
    expect(screen.getByText('Classic Cheeseburger')).toBeInTheDocument();
    expect(screen.getByText('$10.90')).toBeInTheDocument();
  });

  it('groups dishes under category headings', async () => {
    await renderMenu();

    expect(screen.getByRole('heading', { name: 'Pizza', level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Burgers', level: 2 })).toBeInTheDocument();
  });

  it('shows an error with a retry when the menu cannot be loaded', async () => {
    // A fresh response per call: the menu and categories are fetched in
    // parallel, and a single Response body can only be read once.
    fetchMock = vi.fn(jsonResponder(makeErrorBody('http_error', 'Service down'), 503));
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<MenuPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/service down/i);
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('retries the request when asked', async () => {
    fetchMock = vi.fn(jsonResponder(makeErrorBody('http_error', 'Service down'), 503));
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<MenuPage />);
    await screen.findByRole('alert');

    const user = userEvent.setup();
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(jsonResponse(url.includes('categories') ? CATEGORIES : MENU)),
    );
    await user.click(screen.getByRole('button', { name: /try again/i }));

    expect(await screen.findByText('Margherita Pizza')).toBeInTheDocument();
  });
});

describe('filtering', () => {
  it('narrows the menu to one category', async () => {
    const user = await renderMenu();

    await user.click(screen.getByRole('button', { name: 'Pizza' }));

    expect(screen.getByText('Margherita Pizza')).toBeInTheDocument();
    expect(screen.queryByText('Classic Cheeseburger')).not.toBeInTheDocument();
  });

  it('marks the active category for assistive technology', async () => {
    const user = await renderMenu();

    await user.click(screen.getByRole('button', { name: 'Drinks' }));

    expect(screen.getByRole('button', { name: 'Drinks' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('searches by name', async () => {
    const user = await renderMenu();

    await user.type(screen.getByLabelText(/search the menu/i), 'lemon');

    expect(screen.getByText('Fresh Lemonade')).toBeInTheDocument();
    expect(screen.queryByText('Margherita Pizza')).not.toBeInTheDocument();
  });

  it('searches the description too', async () => {
    const user = await renderMenu();

    await user.type(screen.getByLabelText(/search the menu/i), 'cheddar');

    expect(screen.getByText('Classic Cheeseburger')).toBeInTheDocument();
  });

  it('filters locally without hitting the API again', async () => {
    // The menu is small enough to filter client-side, which feels instant.
    const user = await renderMenu();
    const callsAfterLoad = fetchMock.mock.calls.length;

    await user.type(screen.getByLabelText(/search the menu/i), 'pizza');

    expect(fetchMock.mock.calls).toHaveLength(callsAfterLoad);
  });

  it('offers a way out when nothing matches', async () => {
    const user = await renderMenu();

    await user.type(screen.getByLabelText(/search the menu/i), 'sushi omakase');
    expect(screen.getByText(/nothing matches that/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /clear filters/i }));

    expect(screen.getByText('Margherita Pizza')).toBeInTheDocument();
  });
});

describe('adding to the cart', () => {
  it('adds a dish and shows the running total', async () => {
    const user = await renderMenu();

    await user.click(screen.getByRole('button', { name: /add margherita pizza to cart/i }));

    const cart = screen.getByTestId('cart-summary');
    expect(within(cart).getByText('Margherita Pizza')).toBeInTheDocument();
    // 1150 + 299 delivery
    expect(screen.getByTestId('cart-total')).toHaveTextContent('$14.49');
  });

  it('swaps the add button for a stepper once a dish is in the cart', async () => {
    const user = await renderMenu();

    await user.click(screen.getByRole('button', { name: /add margherita pizza to cart/i }));

    expect(screen.getByTestId('stepper-1')).toBeInTheDocument();
    expect(screen.getByTestId('in-cart-badge-1')).toHaveTextContent('1 in cart');
  });

  it('increases the quantity from the menu card', async () => {
    const user = await renderMenu();
    await user.click(screen.getByRole('button', { name: /add margherita pizza to cart/i }));

    const stepper = screen.getByTestId('stepper-1');
    await user.click(within(stepper).getByRole('button', { name: /increase/i }));

    expect(screen.getByTestId('in-cart-badge-1')).toHaveTextContent('2 in cart');
    // 2 x $11.50 = $23.00 line total, still under the $25 free-delivery
    // threshold, so the $2.99 fee applies.
    expect(within(screen.getByTestId('cart-line-1')).getByText('$23.00')).toBeInTheDocument();
    expect(screen.getByTestId('cart-total')).toHaveTextContent('$25.99');
  });

  it('waives the delivery fee once the basket is large enough', async () => {
    const user = await renderMenu();
    await user.click(screen.getByRole('button', { name: /add margherita pizza to cart/i }));

    const stepper = screen.getByTestId('stepper-1');
    await user.click(within(stepper).getByRole('button', { name: /increase/i }));
    await user.click(within(stepper).getByRole('button', { name: /increase/i }));

    expect(screen.getByText('Free')).toBeInTheDocument();
    expect(screen.getByTestId('cart-total')).toHaveTextContent('$34.50');
  });

  it('tells the customer how much more earns free delivery', async () => {
    const user = await renderMenu();

    await user.click(screen.getByRole('button', { name: /add fresh lemonade to cart/i }));

    expect(screen.getByText(/add \$21\.50 more for free delivery/i)).toBeInTheDocument();
  });

  it('removes a dish when decremented from one', async () => {
    const user = await renderMenu();
    await user.click(screen.getByRole('button', { name: /add margherita pizza to cart/i }));

    const stepper = screen.getByTestId('stepper-1');
    await user.click(within(stepper).getByRole('button', { name: /remove .* from cart/i }));

    expect(screen.getByTestId('cart-empty')).toBeInTheDocument();
  });

  it('keeps separate dishes on separate lines', async () => {
    const user = await renderMenu();

    await user.click(screen.getByRole('button', { name: /add margherita pizza to cart/i }));
    await user.click(screen.getByRole('button', { name: /add classic cheeseburger to cart/i }));

    expect(screen.getByTestId('cart-line-1')).toBeInTheDocument();
    expect(screen.getByTestId('cart-line-2')).toBeInTheDocument();
  });

  it('empties the cart on clear', async () => {
    const user = await renderMenu();
    await user.click(screen.getByRole('button', { name: /add margherita pizza to cart/i }));

    await user.click(screen.getByRole('button', { name: /clear cart/i }));

    expect(screen.getByTestId('cart-empty')).toBeInTheDocument();
  });

  it('starts with an empty cart message', async () => {
    await renderMenu();

    expect(screen.getByTestId('cart-empty')).toBeInTheDocument();
    expect(screen.getByText(/your cart is empty/i)).toBeInTheDocument();
  });
});
