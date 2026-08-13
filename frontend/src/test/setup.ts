/**
 * Vitest setup.
 *
 * jsdom is missing a few browser APIs the app relies on, so they are provided
 * here rather than being worked around in individual tests.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// jsdom does not implement WebSocket. Tests that need one install a fake via
// `installFakeWebSocket()`; this stub keeps components from throwing in the
// tests that do not care about the live connection.
if (!('WebSocket' in window)) {
  class UnsupportedWebSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    readonly readyState = UnsupportedWebSocket.CLOSED;
    close(): void {}
    send(): void {}
  }
  vi.stubGlobal('WebSocket', UnsupportedWebSocket);
}

// Not implemented in jsdom; the menu grid uses it indirectly via scroll effects.
if (!window.matchMedia) {
  vi.stubGlobal(
    'matchMedia',
    (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  );
}
