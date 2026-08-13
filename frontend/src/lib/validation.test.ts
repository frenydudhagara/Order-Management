/**
 * Checkout validation rules.
 *
 * These mirror the backend's constraints; the corresponding pytest cases assert
 * the same boundaries server-side, so the two cannot silently drift.
 */

import { describe, expect, it } from 'vitest';

import {
  hasErrors,
  validateAddress,
  validateDeliveryDetails,
  validateName,
  validateNotes,
  validatePhone,
} from './validation';

describe('validateName', () => {
  it.each(['Priya Sharma', "Zoë O'Brien-Müller", 'Li Wei', 'Jo'])('accepts %s', (name) => {
    expect(validateName(name)).toBeUndefined();
  });

  it('rejects an empty value', () => {
    expect(validateName('')).toMatch(/enter your name/i);
  });

  it('rejects whitespace only', () => {
    expect(validateName('   ')).toMatch(/enter your name/i);
  });

  it('rejects a single character', () => {
    expect(validateName('A')).toMatch(/full name/i);
  });

  it('rejects digits with no letters', () => {
    expect(validateName('12345')).toMatch(/at least one letter/i);
  });

  it('rejects a value over the length limit', () => {
    expect(validateName('a'.repeat(121))).toMatch(/under 120/i);
  });
});

describe('validatePhone', () => {
  it.each([
    '+44 20 7946 0958',
    '020 7946 0958',
    '(415) 555-0134',
    '+1-415-555-0134',
    '9876543210',
    '+91 98765 43210',
  ])('accepts %s', (phone) => {
    expect(validatePhone(phone)).toBeUndefined();
  });

  it('rejects an empty value', () => {
    expect(validatePhone('')).toMatch(/enter a phone number/i);
  });

  it('rejects letters', () => {
    expect(validatePhone('call me maybe')).toMatch(/digits, spaces/i);
  });

  it('rejects an extension suffix', () => {
    expect(validatePhone('+44 7946 0958 ext. 12')).toMatch(/digits, spaces/i);
  });

  it('rejects too few digits', () => {
    expect(validatePhone('12345')).toMatch(/too short/i);
  });

  it('rejects too many digits', () => {
    expect(validatePhone('1'.repeat(16))).toMatch(/too long/i);
  });

  it('accepts exactly the minimum and maximum digit counts', () => {
    expect(validatePhone('1234567')).toBeUndefined();
    expect(validatePhone('1'.repeat(15))).toBeUndefined();
  });
});

describe('validateAddress', () => {
  it('accepts a plausible address', () => {
    expect(validateAddress('42 Wallaby Way, Sydney NSW 2000')).toBeUndefined();
  });

  it('rejects an empty value', () => {
    expect(validateAddress('')).toMatch(/enter your delivery address/i);
  });

  it('rejects something too vague to deliver to', () => {
    expect(validateAddress('Flat 2')).toMatch(/more detail/i);
  });

  it('accepts exactly the minimum length', () => {
    expect(validateAddress('1234567890')).toBeUndefined();
  });

  it('rejects a value over the length limit', () => {
    expect(validateAddress('x'.repeat(501))).toMatch(/under 500/i);
  });
});

describe('validateNotes', () => {
  it('accepts an empty value, because notes are optional', () => {
    expect(validateNotes('')).toBeUndefined();
  });

  it('rejects a value over the length limit', () => {
    expect(validateNotes('x'.repeat(501))).toMatch(/under 500/i);
  });
});

describe('validateDeliveryDetails', () => {
  const valid = {
    customer_name: 'Priya Sharma',
    phone: '+44 20 7946 0958',
    address: '42 Wallaby Way, Sydney NSW 2000',
    notes: '',
  };

  it('reports no errors for valid details', () => {
    const errors = validateDeliveryDetails(valid);

    expect(hasErrors(errors)).toBe(false);
  });

  it('reports every invalid field at once rather than stopping at the first', () => {
    const errors = validateDeliveryDetails({
      customer_name: '',
      phone: 'nope',
      address: 'x',
      notes: '',
    });

    expect(Object.keys(errors).sort()).toEqual(['address', 'customer_name', 'phone']);
    expect(hasErrors(errors)).toBe(true);
  });

  it('keys errors by field name so the form can place them', () => {
    const errors = validateDeliveryDetails({ ...valid, phone: '1' });

    expect(errors.phone).toBeDefined();
    expect(errors.customer_name).toBeUndefined();
  });
});
