/**
 * The order ids this browser has placed.
 *
 * There is no login in this feature, so "my orders" is whatever this browser
 * remembers. Only ids are stored; the details are fetched from the API, which
 * stays the single source of truth for status and totals.
 */

import { useCallback, useEffect, useState } from 'react';

import { api } from '../api/client';
import { readJson, writeJson } from '../lib/storage';
import { ORDER_IDS_STORAGE_KEY } from '../lib/storageKeys';
import type { OrderSummary } from '../types';

const MAX_REMEMBERED = 25;

export function readOrderIds(): string[] {
  const stored = readJson<unknown>(ORDER_IDS_STORAGE_KEY, []);
  if (!Array.isArray(stored)) return [];
  return stored.filter((value): value is string => typeof value === 'string');
}

/** Remember a newly placed order, newest first and without duplicates. */
export function rememberOrderId(orderId: string): void {
  const existing = readOrderIds().filter((id) => id !== orderId);
  writeJson(ORDER_IDS_STORAGE_KEY, [orderId, ...existing].slice(0, MAX_REMEMBERED));
}

export function forgetOrderIds(): void {
  writeJson(ORDER_IDS_STORAGE_KEY, []);
}

interface UseOrderHistoryResult {
  orders: OrderSummary[];
  isLoading: boolean;
  error: string | null;
  hasStoredIds: boolean;
  reload: () => void;
  clear: () => void;
}

export function useOrderHistory(): UseOrderHistoryResult {
  const [orderIds, setOrderIds] = useState<string[]>(() => readOrderIds());
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [isLoading, setIsLoading] = useState(orderIds.length > 0);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const reload = useCallback(() => {
    setOrderIds(readOrderIds());
    setAttempt((value) => value + 1);
  }, []);

  const clear = useCallback(() => {
    forgetOrderIds();
    setOrderIds([]);
    setOrders([]);
  }, []);

  useEffect(() => {
    if (orderIds.length === 0) {
      setOrders([]);
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    let active = true;
    setIsLoading(true);
    setError(null);

    api
      .getOrderSummaries(orderIds, controller.signal)
      .then((summaries) => {
        if (active) setOrders(summaries);
      })
      .catch((cause: unknown) => {
        if (!active || controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : 'Could not load your orders.');
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
    // `orderIds` is a fresh array each reload, so `attempt` is what makes the
    // dependency change intentional rather than incidental.
  }, [orderIds, attempt]);

  return {
    orders,
    isLoading,
    error,
    hasStoredIds: orderIds.length > 0,
    reload,
    clear,
  };
}
