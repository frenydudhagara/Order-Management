/** Render helpers and fakes shared by the tests. */

import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';

import { CartProvider } from '../cart/CartContext';

interface RenderWithProvidersOptions extends Omit<RenderOptions, 'wrapper'> {
  /** Initial router entry, e.g. '/orders/abc'. */
  route?: string;
  /** Set false to render without the cart provider (e.g. testing the error). */
  withCart?: boolean;
}

/** Render inside the providers a page component expects. */
export function renderWithProviders(
  ui: ReactElement,
  { route = '/', withCart = true, ...options }: RenderWithProvidersOptions = {},
): RenderResult {
  function Wrapper({ children }: { children: ReactNode }) {
    const content = withCart ? <CartProvider>{children}</CartProvider> : children;
    return <MemoryRouter initialEntries={[route]}>{content}</MemoryRouter>;
  }

  return render(ui, { wrapper: Wrapper, ...options });
}

/** Build a JSON `Response` for a fetch stub. */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * A fetch implementation returning a *fresh* response per call.
 *
 * A `Response` body can only be read once, so handing the same instance to
 * `mockResolvedValue` breaks the second call ("body already read"). Any stub
 * that may be hit more than once -- polling, retries, parallel requests --
 * must build a new response each time.
 */
export function jsonResponder(body: unknown, status = 200): () => Promise<Response> {
  return () => Promise.resolve(jsonResponse(body, status));
}

/**
 * A controllable fake WebSocket.
 *
 * jsdom has no WebSocket, and a real one would make tests depend on a running
 * server. This records what the app did and lets a test push messages in.
 */
export class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  /** Every instance created during a test, in order. */
  static instances: FakeWebSocket[] = [];

  readonly url: string;
  readyState: number = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  closed = false;

  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    this.readyState = FakeWebSocket.CLOSED;
  }

  // -- test controls ----------------------------------------------------

  /** Simulate the connection opening. */
  simulateOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  /** Push a server message. */
  simulateMessage(payload: unknown): void {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(payload) }));
  }

  /** Push a raw (possibly malformed) frame. */
  simulateRawMessage(data: string): void {
    this.onmessage?.(new MessageEvent('message', { data }));
  }

  /** Simulate the server or network closing the connection. */
  simulateClose(code = 1006): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.(new CloseEvent('close', { code }));
  }

  static get latest(): FakeWebSocket | undefined {
    return FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  }

  static reset(): void {
    FakeWebSocket.instances = [];
  }
}

/** Install `FakeWebSocket` as the global WebSocket for the current test. */
export function installFakeWebSocket(): typeof FakeWebSocket {
  FakeWebSocket.reset();
  vi.stubGlobal('WebSocket', FakeWebSocket);
  return FakeWebSocket;
}
