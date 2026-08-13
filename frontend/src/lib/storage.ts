/**
 * Small localStorage wrapper.
 *
 * Reads are defensive on purpose: storage can be unavailable (Safari private
 * browsing throws on write) or hold data written by an older version of the
 * app, and neither should crash the page.
 */

export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exceeded or storage disabled. The app works without persistence.
  }
}

export function remove(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
