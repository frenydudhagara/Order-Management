/**
 * Delivery details form.
 *
 * Validation runs on blur and again on submit -- validating on every keystroke
 * would flag a phone number as invalid while it is still being typed. Server
 * field errors are merged into the same display path, so there is one place
 * that renders a message per input.
 */

import { useState, type FormEvent } from 'react';

import type { DeliveryDetails } from '../types';
import {
  LIMITS,
  hasErrors,
  validateDeliveryDetails,
  validateField,
  type DeliveryField,
  type FieldErrors,
} from '../lib/validation';
import { AlertIcon, SpinnerIcon } from './Icons';

const EMPTY_DETAILS: DeliveryDetails = {
  customer_name: '',
  phone: '',
  address: '',
  notes: '',
};

interface CheckoutFormProps {
  onSubmit: (details: DeliveryDetails) => void;
  isSubmitting?: boolean;
  /** Field errors returned by the API, keyed the same way as local ones. */
  serverFieldErrors?: Record<string, string>;
  submitLabel?: string;
  disabled?: boolean;
}

export function CheckoutForm({
  onSubmit,
  isSubmitting = false,
  serverFieldErrors = {},
  submitLabel = 'Place order',
  disabled = false,
}: CheckoutFormProps) {
  const [details, setDetails] = useState<DeliveryDetails>(EMPTY_DETAILS);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [touched, setTouched] = useState<Partial<Record<DeliveryField, boolean>>>({});

  const update = (field: DeliveryField, value: string) => {
    setDetails((current) => ({ ...current, [field]: value }));
    // Clear a visible error as soon as the input becomes valid, so the message
    // does not linger while the customer is fixing it.
    if (errors[field] && !validateField(field, value)) {
      setErrors((current) => ({ ...current, [field]: undefined }));
    }
  };

  const handleBlur = (field: DeliveryField) => {
    setTouched((current) => ({ ...current, [field]: true }));
    setErrors((current) => ({ ...current, [field]: validateField(field, details[field]) }));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const nextErrors = validateDeliveryDetails(details);
    setErrors(nextErrors);
    setTouched({ customer_name: true, phone: true, address: true, notes: true });

    if (hasErrors(nextErrors)) {
      // Move focus to the first problem so keyboard and screen reader users
      // are not left guessing where the error is.
      const firstField = Object.keys(nextErrors)[0] as DeliveryField | undefined;
      if (firstField) document.getElementById(firstField)?.focus();
      return;
    }

    onSubmit({
      customer_name: details.customer_name.trim(),
      phone: details.phone.trim(),
      address: details.address.trim(),
      notes: details.notes.trim(),
    });
  };

  const errorFor = (field: DeliveryField): string | undefined =>
    (touched[field] ? errors[field] : undefined) ?? serverFieldErrors[field];

  return (
    <form onSubmit={handleSubmit} noValidate data-testid="checkout-form">
      <div className="space-y-5">
        <Field
          id="customer_name"
          label="Full name"
          value={details.customer_name}
          error={errorFor('customer_name')}
          autoComplete="name"
          placeholder="Priya Sharma"
          maxLength={LIMITS.nameMax}
          onChange={(value) => update('customer_name', value)}
          onBlur={() => handleBlur('customer_name')}
        />

        <Field
          id="phone"
          label="Phone number"
          value={details.phone}
          error={errorFor('phone')}
          type="tel"
          autoComplete="tel"
          placeholder="+1 415 555 0134"
          hint="The driver will call this number if they cannot find you."
          maxLength={32}
          onChange={(value) => update('phone', value)}
          onBlur={() => handleBlur('phone')}
        />

        <Field
          id="address"
          label="Delivery address"
          value={details.address}
          error={errorFor('address')}
          multiline
          autoComplete="street-address"
          placeholder="42 Wallaby Way, Apt 3B, Sydney NSW 2000"
          maxLength={LIMITS.addressMax}
          onChange={(value) => update('address', value)}
          onBlur={() => handleBlur('address')}
        />

        <Field
          id="notes"
          label="Delivery notes"
          labelSuffix="optional"
          value={details.notes}
          error={errorFor('notes')}
          multiline
          rows={2}
          placeholder="Leave at the door, buzzer is broken."
          maxLength={LIMITS.notesMax}
          onChange={(value) => update('notes', value)}
          onBlur={() => handleBlur('notes')}
        />
      </div>

      <button
        type="submit"
        disabled={isSubmitting || disabled}
        className="btn-primary mt-7 w-full py-3 text-base"
      >
        {isSubmitting && <SpinnerIcon className="h-4 w-4" />}
        {isSubmitting ? 'Placing your order…' : submitLabel}
      </button>
    </form>
  );
}

interface FieldProps {
  id: DeliveryField;
  label: string;
  labelSuffix?: string;
  value: string;
  error?: string;
  hint?: string;
  type?: string;
  autoComplete?: string;
  placeholder?: string;
  maxLength?: number;
  multiline?: boolean;
  rows?: number;
  onChange: (value: string) => void;
  onBlur: () => void;
}

function Field({
  id,
  label,
  labelSuffix,
  value,
  error,
  hint,
  type = 'text',
  autoComplete,
  placeholder,
  maxLength,
  multiline = false,
  rows = 3,
  onChange,
  onBlur,
}: FieldProps) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  // Point the input at whichever descriptions actually exist, so assistive
  // tech never announces a dangling reference.
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ');

  const shared = {
    id,
    name: id,
    value,
    placeholder,
    maxLength,
    autoComplete,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy || undefined,
    className: `field-input ${error ? 'field-input-error' : ''}`,
    onChange: (event: { target: { value: string } }) => onChange(event.target.value),
    onBlur,
  };

  return (
    <div>
      <label htmlFor={id} className="field-label">
        {label}
        {labelSuffix && (
          <span className="ml-1.5 font-normal text-stone-400">({labelSuffix})</span>
        )}
      </label>

      {multiline ? (
        <textarea {...shared} rows={rows} className={`${shared.className} resize-y`} />
      ) : (
        <input {...shared} type={type} />
      )}

      {hint && !error && (
        <p id={hintId} className="mt-1.5 text-xs text-stone-500">
          {hint}
        </p>
      )}

      {error && (
        <p id={errorId} className="field-error" role="alert">
          <AlertIcon className="mt-px h-4 w-4 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}
