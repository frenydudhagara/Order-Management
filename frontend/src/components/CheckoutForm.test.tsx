/** Checkout form validation and submission behaviour. */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { CheckoutForm } from './CheckoutForm';

const VALID = {
  name: 'Priya Sharma',
  phone: '+44 20 7946 0958',
  address: '42 Wallaby Way, Sydney NSW 2000',
};

function renderForm(props: Partial<Parameters<typeof CheckoutForm>[0]> = {}) {
  const onSubmit = vi.fn();
  render(<CheckoutForm onSubmit={onSubmit} {...props} />);
  return { onSubmit, user: userEvent.setup() };
}

const nameField = () => screen.getByLabelText(/full name/i);
const phoneField = () => screen.getByLabelText(/phone number/i);
const addressField = () => screen.getByLabelText(/delivery address/i);
const submitButton = () => screen.getByRole('button', { name: /place order/i });

async function fillValidForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(nameField(), VALID.name);
  await user.type(phoneField(), VALID.phone);
  await user.type(addressField(), VALID.address);
}

describe('submission', () => {
  it('submits the trimmed details when everything is valid', async () => {
    const { onSubmit, user } = renderForm();

    await user.type(nameField(), `  ${VALID.name}  `);
    await user.type(phoneField(), VALID.phone);
    await user.type(addressField(), VALID.address);
    await user.click(submitButton());

    expect(onSubmit).toHaveBeenCalledWith({
      customer_name: VALID.name,
      phone: VALID.phone,
      address: VALID.address,
      notes: '',
    });
  });

  it('includes optional notes when provided', async () => {
    const { onSubmit, user } = renderForm();

    await fillValidForm(user);
    await user.type(screen.getByLabelText(/delivery notes/i), 'Leave at the door');
    await user.click(submitButton());

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ notes: 'Leave at the door' }),
    );
  });

  it('does not submit an empty form', async () => {
    const { onSubmit, user } = renderForm();

    await user.click(submitButton());

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows a message for every missing field at once', async () => {
    const { user } = renderForm();

    await user.click(submitButton());

    expect(await screen.findByText(/please enter your name/i)).toBeInTheDocument();
    expect(screen.getByText(/please enter a phone number/i)).toBeInTheDocument();
    expect(screen.getByText(/please enter your delivery address/i)).toBeInTheDocument();
  });

  it('focuses the first invalid field so the error is not missed', async () => {
    const { user } = renderForm();

    await user.click(submitButton());

    await waitFor(() => expect(nameField()).toHaveFocus());
  });

  it('disables the button while submitting', () => {
    renderForm({ isSubmitting: true });

    expect(screen.getByRole('button', { name: /placing your order/i })).toBeDisabled();
  });

  it('can be disabled from outside', () => {
    renderForm({ disabled: true });

    expect(submitButton()).toBeDisabled();
  });
});

describe('validation timing', () => {
  it('does not complain while a field is still being typed', async () => {
    // Flagging "too short" mid-typing would be hostile.
    const { user } = renderForm();

    await user.type(phoneField(), '12');

    expect(screen.queryByText(/too short/i)).not.toBeInTheDocument();
  });

  it('validates a field once it loses focus', async () => {
    const { user } = renderForm();

    await user.type(phoneField(), '12');
    await user.tab();

    expect(await screen.findByText(/too short/i)).toBeInTheDocument();
  });

  it('clears the error as soon as the input becomes valid', async () => {
    const { user } = renderForm();

    await user.click(submitButton());
    expect(await screen.findByText(/please enter your name/i)).toBeInTheDocument();

    await user.type(nameField(), VALID.name);

    expect(screen.queryByText(/please enter your name/i)).not.toBeInTheDocument();
  });
});

describe('field rules', () => {
  it.each([
    ['no letters at all', '12345', /at least one letter/i],
    // Matched on the message alone -- /full name/i would also hit the label.
    ['a single character', 'A', /please enter your full name/i],
  ])('rejects a name that is %s', async (_label, value, expected) => {
    const { user } = renderForm();

    await user.type(nameField(), value);
    await user.tab();

    expect(await screen.findByText(expected)).toBeInTheDocument();
  });

  it('accepts a name with accents and an apostrophe', async () => {
    const { user } = renderForm();

    await user.type(nameField(), "Zoë O'Brien");
    await user.tab();

    expect(screen.queryByText(/at least one letter/i)).not.toBeInTheDocument();
  });

  it.each([
    ['+44 20 7946 0958'],
    ['(415) 555-0134'],
    ['020 7946 0958'],
    ['9876543210'],
  ])('accepts the phone format %s', async (phone) => {
    const { user } = renderForm();

    await user.type(phoneField(), phone);
    await user.tab();

    expect(screen.queryByText(/digits, spaces/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/too short|too long/i)).not.toBeInTheDocument();
  });

  it('rejects a phone number containing letters', async () => {
    const { user } = renderForm();

    await user.type(phoneField(), 'call me maybe');
    await user.tab();

    expect(await screen.findByText(/digits, spaces, dashes or brackets/i)).toBeInTheDocument();
  });

  it('rejects a phone number with too many digits', async () => {
    const { user } = renderForm();

    await user.type(phoneField(), '1234567890123456');
    await user.tab();

    expect(await screen.findByText(/too long/i)).toBeInTheDocument();
  });

  it('rejects an address too vague to deliver to', async () => {
    const { user } = renderForm();

    await user.type(addressField(), 'Flat 2');
    await user.tab();

    expect(await screen.findByText(/a bit more detail/i)).toBeInTheDocument();
  });

  it('treats notes as optional', async () => {
    const { onSubmit, user } = renderForm();

    await fillValidForm(user);
    await user.click(screen.getByLabelText(/delivery notes/i));
    await user.tab();
    await user.click(submitButton());

    expect(onSubmit).toHaveBeenCalled();
  });
});

describe('server errors', () => {
  it('displays field errors returned by the API', async () => {
    // The server is the real authority, so its messages must be shown even
    // when the client thought the input was fine.
    renderForm({ serverFieldErrors: { phone: 'This number is not in our delivery area.' } });

    expect(await screen.findByText(/not in our delivery area/i)).toBeInTheDocument();
  });

  it('attaches a server error to the right input', () => {
    renderForm({ serverFieldErrors: { address: 'We do not deliver there yet.' } });

    expect(addressField()).toHaveAttribute('aria-invalid', 'true');
    expect(addressField()).toHaveAccessibleDescription(/do not deliver there yet/i);
  });
});

describe('accessibility', () => {
  it('labels every input', () => {
    renderForm();

    expect(nameField()).toBeInTheDocument();
    expect(phoneField()).toBeInTheDocument();
    expect(addressField()).toBeInTheDocument();
    expect(screen.getByLabelText(/delivery notes/i)).toBeInTheDocument();
  });

  it('marks an invalid field and links its message', async () => {
    const { user } = renderForm();

    await user.click(submitButton());

    await waitFor(() => expect(nameField()).toHaveAttribute('aria-invalid', 'true'));
    expect(nameField()).toHaveAccessibleDescription(/please enter your name/i);
  });

  it('announces errors to assistive technology', async () => {
    const { user } = renderForm();

    await user.click(submitButton());

    const alerts = await screen.findAllByRole('alert');
    expect(alerts.length).toBeGreaterThanOrEqual(3);
  });

  it('describes the phone field with a hint before any error', () => {
    renderForm();

    expect(phoneField()).toHaveAccessibleDescription(/driver will call/i);
  });
});
