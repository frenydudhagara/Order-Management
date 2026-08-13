/** Loads the menu, with cancellation on unmount and a retry hook. */

import { useCallback, useEffect, useState } from 'react';

import { api } from '../api/client';
import type { MenuItem } from '../types';

interface UseMenuResult {
  items: MenuItem[];
  categories: string[];
  isLoading: boolean;
  error: string | null;
  reload: () => void;
}

export function useMenu(): UseMenuResult {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    setIsLoading(true);
    setError(null);

    // One round trip each, in parallel -- the menu view needs both before it
    // can render, so serialising them would double the wait.
    Promise.all([api.getMenu({}, controller.signal), api.getCategories(controller.signal)])
      .then(([menuItems, menuCategories]) => {
        if (!active) return;
        setItems(menuItems);
        setCategories(menuCategories);
      })
      .catch((cause: unknown) => {
        if (!active || controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : 'Could not load the menu.');
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [attempt]);

  return { items, categories, isLoading, error, reload };
}
