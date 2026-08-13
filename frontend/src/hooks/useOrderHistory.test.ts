/** Remembering order ids in this browser. */

import { describe, expect, it } from 'vitest';

import { ORDER_IDS_STORAGE_KEY } from '../lib/storageKeys';
import { forgetOrderIds, readOrderIds, rememberOrderId } from './useOrderHistory';

const ID_A = 'aaaaaaaa-1111-4111-8111-111111111111';
const ID_B = 'bbbbbbbb-2222-4222-8222-222222222222';

function stored(): unknown {
  return JSON.parse(window.localStorage.getItem(ORDER_IDS_STORAGE_KEY) ?? 'null');
}

describe('readOrderIds', () => {
  it('returns an empty list when nothing is stored', () => {
    expect(readOrderIds()).toEqual([]);
  });

  it('returns stored ids', () => {
    window.localStorage.setItem(ORDER_IDS_STORAGE_KEY, JSON.stringify([ID_A, ID_B]));

    expect(readOrderIds()).toEqual([ID_A, ID_B]);
  });

  it('survives malformed JSON', () => {
    window.localStorage.setItem(ORDER_IDS_STORAGE_KEY, '{{{');

    expect(readOrderIds()).toEqual([]);
  });

  it('survives stored data that is not an array', () => {
    window.localStorage.setItem(ORDER_IDS_STORAGE_KEY, JSON.stringify({ nope: true }));

    expect(readOrderIds()).toEqual([]);
  });

  it('filters out entries that are not strings', () => {
    window.localStorage.setItem(ORDER_IDS_STORAGE_KEY, JSON.stringify([ID_A, 42, null]));

    expect(readOrderIds()).toEqual([ID_A]);
  });
});

describe('rememberOrderId', () => {
  it('stores a new id', () => {
    rememberOrderId(ID_A);

    expect(stored()).toEqual([ID_A]);
  });

  it('puts the newest order first', () => {
    rememberOrderId(ID_A);
    rememberOrderId(ID_B);

    expect(stored()).toEqual([ID_B, ID_A]);
  });

  it('moves a repeated id to the front rather than duplicating it', () => {
    rememberOrderId(ID_A);
    rememberOrderId(ID_B);
    rememberOrderId(ID_A);

    expect(stored()).toEqual([ID_A, ID_B]);
  });

  it('caps the list so storage cannot grow without bound', () => {
    for (let index = 0; index < 40; index += 1) {
      rememberOrderId(`order-${index}`);
    }

    expect((stored() as string[]).length).toBe(25);
    expect((stored() as string[])[0]).toBe('order-39');
  });
});

describe('forgetOrderIds', () => {
  it('empties the list', () => {
    rememberOrderId(ID_A);

    forgetOrderIds();

    expect(readOrderIds()).toEqual([]);
  });
});
