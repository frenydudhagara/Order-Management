/** The menu item card: add button vs. quantity stepper, and image fallback. */

import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { MAX_QUANTITY_PER_ITEM } from '../cart/cartReducer';
import { makeMenuItem } from '../test/factories';
import { MenuItemCard } from './MenuItemCard';

const item = makeMenuItem({
  id: 42,
  name: 'Truffle Mushroom Pizza',
  description: 'Wild mushrooms, taleggio and black truffle.',
  price_cents: 1590,
});

function renderCard(quantity = 0) {
  const handlers = {
    onAdd: vi.fn(),
    onIncrement: vi.fn(),
    onDecrement: vi.fn(),
  };
  render(<MenuItemCard item={item} quantity={quantity} {...handlers} />);
  return handlers;
}

describe('presentation', () => {
  it('shows the name, description and price', () => {
    renderCard();

    expect(screen.getByRole('heading', { name: 'Truffle Mushroom Pizza' })).toBeInTheDocument();
    expect(screen.getByText(/wild mushrooms/i)).toBeInTheDocument();
    expect(screen.getByText('$15.90')).toBeInTheDocument();
  });

  it('renders the image with the dish name as alternative text', () => {
    renderCard();

    const image = screen.getByRole('img', { name: 'Truffle Mushroom Pizza' });
    expect(image).toHaveAttribute('src', item.image_url);
    expect(image).toHaveAttribute('loading', 'lazy');
  });

  it('falls back to a placeholder when the image fails to load', () => {
    // Images are hotlinked from a CDN, so this is a normal case, not an edge one.
    renderCard();

    fireEvent.error(screen.getByRole('img', { name: 'Truffle Mushroom Pizza' }));

    expect(screen.getByRole('img', { name: /image unavailable/i })).toBeInTheDocument();
  });

  it('formats cents as money rather than showing a raw integer', () => {
    render(
      <MenuItemCard
        item={makeMenuItem({ price_cents: 350 })}
        quantity={0}
        onAdd={vi.fn()}
        onIncrement={vi.fn()}
        onDecrement={vi.fn()}
      />,
    );

    expect(screen.getByText('$3.50')).toBeInTheDocument();
  });
});

describe('when the item is not in the cart', () => {
  it('offers an add button', () => {
    renderCard(0);

    expect(
      screen.getByRole('button', { name: /add truffle mushroom pizza to cart/i }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('stepper-42')).not.toBeInTheDocument();
  });

  it('calls onAdd with the item', async () => {
    const user = userEvent.setup();
    const { onAdd } = renderCard(0);

    await user.click(screen.getByRole('button', { name: /add .* to cart/i }));

    expect(onAdd).toHaveBeenCalledWith(item);
  });

  it('shows no in-cart badge', () => {
    renderCard(0);

    expect(screen.queryByTestId('in-cart-badge-42')).not.toBeInTheDocument();
  });
});

describe('when the item is in the cart', () => {
  it('swaps the add button for a stepper', () => {
    renderCard(2);

    expect(screen.getByTestId('stepper-42')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add .* to cart/i })).not.toBeInTheDocument();
  });

  it('shows how many are in the cart', () => {
    renderCard(3);

    expect(screen.getByTestId('in-cart-badge-42')).toHaveTextContent('3 in cart');
  });

  it('increments and decrements through the callbacks', async () => {
    const user = userEvent.setup();
    const { onIncrement, onDecrement } = renderCard(2);

    await user.click(screen.getByRole('button', { name: /increase/i }));
    await user.click(screen.getByRole('button', { name: /decrease/i }));

    expect(onIncrement).toHaveBeenCalledWith(42);
    expect(onDecrement).toHaveBeenCalledWith(42);
  });

  it('labels the decrement button as "remove" at a quantity of one', () => {
    // At one, pressing minus empties the line -- the label should say so.
    renderCard(1);

    expect(
      screen.getByRole('button', { name: /remove truffle mushroom pizza from cart/i }),
    ).toBeInTheDocument();
  });

  it('disables incrementing at the per-item maximum', () => {
    renderCard(MAX_QUANTITY_PER_ITEM);

    expect(screen.getByRole('button', { name: /increase/i })).toBeDisabled();
  });

  it('announces the quantity to screen readers', () => {
    renderCard(4);

    // Without a live region the number changes silently for screen reader users.
    const quantity = screen.getByText('4', { selector: 'span' });
    expect(quantity).toHaveAttribute('aria-live', 'polite');
  });
});
