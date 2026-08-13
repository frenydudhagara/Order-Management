/**
 * Live order tracking.
 *
 * Transport strategy
 * ------------------
 * A WebSocket is opened first, because push is what makes the status feel
 * instant. Sockets are not universally reachable though -- corporate proxies
 * strip upgrade requests, and some serverless hosts do not support them at all
 * -- so a failed or dropped connection falls back to polling rather than
 * leaving the page frozen on a stale status. The UI shows which mode is active
 * so the behaviour is never a mystery.
 *
 * Reconnects use exponential backoff with a cap. Retrying every second would
 * hammer a struggling server exactly when it is least able to cope.
 *
 * The server's first message is a full snapshot, and every update carries the
 * complete order, so the client never has to reconcile a partial patch.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { api, ApiError } from '../api/client';
import { orderSocketUrl } from '../api/config';
import type { LiveConnectionState, Order, WebSocketMessage } from '../types';

/** Close code the server uses for "this order does not exist". */
const CLOSE_ORDER_NOT_FOUND = 4404;

const POLL_INTERVAL_MS = 4000;
const PING_INTERVAL_MS = 25_000;
const MAX_SOCKET_ATTEMPTS = 4;
const BACKOFF_BASE_MS = 800;
const BACKOFF_CAP_MS = 8000;

export interface UseOrderTrackingResult {
  order: Order | null;
  isLoading: boolean;
  error: string | null;
  notFound: boolean;
  connection: LiveConnectionState;
  refresh: () => void;
}

function isTerminal(order: Order | null): boolean {
  return order?.status === 'Delivered' || order?.status === 'Cancelled';
}

export function useOrderTracking(orderId: string | undefined): UseOrderTrackingResult {
  const [order, setOrder] = useState<Order | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [connection, setConnection] = useState<LiveConnectionState>('connecting');

  // Kept in refs rather than state: timers and sockets are cleanup concerns,
  // and writing them to state would re-render on every reconnect attempt.
  const socketRef = useRef<WebSocket | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const pingTimerRef = useRef<number | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const attemptsRef = useRef(0);
  const disposedRef = useRef(false);
  /** Mirrors `order` for use inside callbacks that must not be re-created. */
  const orderRef = useRef<Order | null>(null);

  const setOrderState = useCallback((next: Order) => {
    orderRef.current = next;
    setOrder(next);
    setIsLoading(false);
    setError(null);
  }, []);

  const fetchOnce = useCallback(
    async (signal?: AbortSignal) => {
      if (!orderId) return;
      try {
        setOrderState(await api.getOrder(orderId, signal));
      } catch (cause) {
        if (signal?.aborted) return;
        if (cause instanceof ApiError && cause.status === 404) {
          setNotFound(true);
          setIsLoading(false);
          return;
        }
        setError(cause instanceof Error ? cause.message : 'Could not load this order.');
        setIsLoading(false);
      }
    },
    [orderId, setOrderState],
  );

  const refresh = useCallback(() => {
    void fetchOnce();
  }, [fetchOnce]);

  useEffect(() => {
    if (!orderId) {
      setIsLoading(false);
      return;
    }

    disposedRef.current = false;
    attemptsRef.current = 0;
    const controller = new AbortController();

    // -- helpers ---------------------------------------------------------

    const clearTimer = (ref: React.MutableRefObject<number | null>) => {
      if (ref.current !== null) {
        window.clearInterval(ref.current);
        window.clearTimeout(ref.current);
        ref.current = null;
      }
    };

    const stopPolling = () => clearTimer(pollTimerRef);

    const startPolling = () => {
      if (pollTimerRef.current !== null) return;
      setConnection('polling');
      pollTimerRef.current = window.setInterval(() => {
        // Nothing more will change once the order is finished.
        if (isTerminal(orderRef.current)) {
          stopPolling();
          setConnection('closed');
          return;
        }
        void fetchOnce();
      }, POLL_INTERVAL_MS);
    };

    const openSocket = () => {
      if (disposedRef.current) return;

      let socket: WebSocket;
      try {
        socket = new WebSocket(orderSocketUrl(orderId));
      } catch {
        // Some environments throw synchronously (e.g. a blocked mixed-content
        // upgrade) instead of firing onerror.
        startPolling();
        return;
      }
      socketRef.current = socket;

      socket.onopen = () => {
        if (disposedRef.current) return;
        attemptsRef.current = 0;
        stopPolling();
        setConnection('live');

        clearTimer(pingTimerRef);
        pingTimerRef.current = window.setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) socket.send('ping');
        }, PING_INTERVAL_MS);
      };

      socket.onmessage = (event: MessageEvent<string>) => {
        if (disposedRef.current) return;
        let message: WebSocketMessage;
        try {
          message = JSON.parse(event.data) as WebSocketMessage;
        } catch {
          return; // Ignore anything we cannot parse rather than crashing.
        }
        if (message.type === 'pong') return;
        if (message.data && typeof message.data === 'object' && 'status' in message.data) {
          setOrderState(message.data);
        }
      };

      socket.onerror = () => {
        // `onclose` always follows, so recovery is handled in one place.
      };

      socket.onclose = (event: CloseEvent) => {
        clearTimer(pingTimerRef);
        socketRef.current = null;
        if (disposedRef.current) return;

        if (event.code === CLOSE_ORDER_NOT_FOUND) {
          setNotFound(true);
          setIsLoading(false);
          setConnection('closed');
          return;
        }

        // A finished order has nothing left to push.
        if (isTerminal(orderRef.current)) {
          setConnection('closed');
          return;
        }

        // Start polling immediately so updates keep arriving while we retry.
        // If the socket comes back, `onopen` stops the polling again.
        startPolling();

        attemptsRef.current += 1;
        if (attemptsRef.current > MAX_SOCKET_ATTEMPTS) return; // stay on polling

        const delay = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (attemptsRef.current - 1));
        reconnectTimerRef.current = window.setTimeout(openSocket, delay);
      };
    };

    // Fetch once up front so the page paints even if the socket is slow or
    // never connects.
    void fetchOnce(controller.signal);
    openSocket();

    return () => {
      disposedRef.current = true;
      controller.abort();
      clearTimer(pollTimerRef);
      clearTimer(pingTimerRef);
      clearTimer(reconnectTimerRef);
      const socket = socketRef.current;
      socketRef.current = null;
      if (socket && socket.readyState <= WebSocket.OPEN) socket.close();
    };
  }, [orderId, fetchOnce, setOrderState]);

  return { order, isLoading, error, notFound, connection, refresh };
}
