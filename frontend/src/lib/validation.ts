/**
 * Client-side checkout validation.
 *
 * Mirrors the backend's rules so the customer gets instant feedback instead of
 * a round trip per typo. The server still validates everything -- this is a
 * convenience layer, never the enforcement point, and the form also renders
 * whatever field errors the API returns.
 */

import type { DeliveryDetails } from '../types';

export type DeliveryField = keyof DeliveryDetails;
export type FieldErrors = Partial<Record<DeliveryField, string>>;

const PHONE_ALLOWED = /^\+?[\d\s\-.()]+$/;

export const LIMITS = {
  nameMin: 2,
  nameMax: 120,
  phoneDigitsMin: 7,
  phoneDigitsMax: 15,
  addressMin: 10,
  addressMax: 500,
  notesMax: 500,
} as const;

export function validateName(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return 'Please enter your name.';
  if (trimmed.length < LIMITS.nameMin) return 'Please enter your full name.';
  if (trimmed.length > LIMITS.nameMax) return `Keep this under ${LIMITS.nameMax} characters.`;
  if (!/\p{L}/u.test(trimmed)) return 'Your name needs at least one letter.';
  return undefined;
}

export function validatePhone(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return 'Please enter a phone number so the driver can reach you.';
  if (!PHONE_ALLOWED.test(trimmed)) return 'Use digits, spaces, dashes or brackets only.';

  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < LIMITS.phoneDigitsMin) return 'That number looks too short.';
  if (digits.length > LIMITS.phoneDigitsMax) return 'That number looks too long.';
  return undefined;
}

export function validateAddress(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return 'Please enter your delivery address.';
  if (trimmed.length < LIMITS.addressMin) {
    return 'Add a bit more detail so we can find you.';
  }
  if (trimmed.length > LIMITS.addressMax) return `Keep this under ${LIMITS.addressMax} characters.`;
  return undefined;
}

export function validateNotes(value: string): string | undefined {
  if (value.length > LIMITS.notesMax) return `Keep this under ${LIMITS.notesMax} characters.`;
  return undefined;
}

const VALIDATORS: Record<DeliveryField, (value: string) => string | undefined> = {
  customer_name: validateName,
  phone: validatePhone,
  address: validateAddress,
  notes: validateNotes,
};

export function validateField(field: DeliveryField, value: string): string | undefined {
  return VALIDATORS[field](value);
}

export function validateDeliveryDetails(details: DeliveryDetails): FieldErrors {
  const errors: FieldErrors = {};
  for (const field of Object.keys(VALIDATORS) as DeliveryField[]) {
    const message = validateField(field, details[field]);
    if (message) errors[field] = message;
  }
  return errors;
}

export function hasErrors(errors: FieldErrors): boolean {
  return Object.keys(errors).length > 0;
}
