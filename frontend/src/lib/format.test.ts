/** Display formatting. */

import { describe, expect, it } from 'vitest';

import { formatMoney, formatRelativeTime, slugify } from './format';

describe('formatMoney', () => {
  it('renders cents as money', () => {
    expect(formatMoney(1150)).toBe('$11.50');
  });

  it('keeps two decimal places on a round amount', () => {
    expect(formatMoney(1200)).toBe('$12.00');
  });

  it('handles zero', () => {
    expect(formatMoney(0)).toBe('$0.00');
  });

  it('groups thousands', () => {
    expect(formatMoney(123456)).toBe('$1,234.56');
  });

  it('is exact for amounts that would drift as floats', () => {
    // 0.1 + 0.2 !== 0.3 in binary floating point; integer cents avoid it.
    expect(formatMoney(10 + 20)).toBe('$0.30');
  });
});

describe('formatRelativeTime', () => {
  const now = new Date('2026-08-12T16:00:00Z');

  it('says "just now" for a very recent time', () => {
    expect(formatRelativeTime('2026-08-12T15:59:50Z', now)).toBe('just now');
  });

  it('counts minutes', () => {
    expect(formatRelativeTime('2026-08-12T15:56:00Z', now)).toBe('4 min ago');
  });

  it('counts hours', () => {
    expect(formatRelativeTime('2026-08-12T13:00:00Z', now)).toBe('3 h ago');
  });

  it('says "yesterday" for one day', () => {
    expect(formatRelativeTime('2026-08-11T16:00:00Z', now)).toBe('yesterday');
  });

  it('counts days beyond that', () => {
    expect(formatRelativeTime('2026-08-09T16:00:00Z', now)).toBe('3 days ago');
  });

  it('reads a UTC timestamp as UTC regardless of the browser timezone', () => {
    // Without the explicit Z the browser would treat it as local time and the
    // elapsed value would be wrong by the timezone offset.
    expect(formatRelativeTime('2026-08-12T15:00:00Z', now)).toBe('1 h ago');
  });
});

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Out for Delivery')).toBe('out-for-delivery');
  });

  it('collapses runs of punctuation into one hyphen', () => {
    expect(slugify('Order  --  Received!')).toBe('order-received');
  });

  it('trims leading and trailing hyphens', () => {
    expect(slugify('  Delivered  ')).toBe('delivered');
  });
});
