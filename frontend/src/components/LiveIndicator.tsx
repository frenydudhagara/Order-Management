/**
 * Shows how updates are currently arriving.
 *
 * Worth surfacing: if the WebSocket has fallen back to polling, updates lag by
 * a few seconds, and a customer watching a status bar deserves to know that
 * rather than wonder whether the page is stuck.
 */

import type { LiveConnectionState } from '../types';

const LABELS: Record<LiveConnectionState, { text: string; detail: string; className: string }> = {
  connecting: {
    text: 'Connecting',
    detail: 'Establishing a live connection',
    className: 'bg-stone-100 text-stone-600',
  },
  live: {
    text: 'Live',
    detail: 'Updates arrive the moment the status changes',
    className: 'bg-emerald-100 text-emerald-800',
  },
  polling: {
    text: 'Auto-refreshing',
    detail: 'Live connection unavailable, checking every few seconds',
    className: 'bg-amber-100 text-amber-900',
  },
  closed: {
    text: 'Complete',
    detail: 'This order is finished, so there is nothing left to update',
    className: 'bg-stone-100 text-stone-600',
  },
};

export function LiveIndicator({ state }: { state: LiveConnectionState }) {
  const { text, detail, className } = LABELS[state];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${className}`}
      title={detail}
      data-testid="live-indicator"
      data-state={state}
    >
      <span className="relative flex h-2 w-2">
        {state === 'live' && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
        )}
        <span
          className={`relative inline-flex h-2 w-2 rounded-full ${
            state === 'live'
              ? 'bg-emerald-600'
              : state === 'polling'
                ? 'bg-amber-500'
                : 'bg-stone-400'
          }`}
        />
      </span>
      {text}
      <span className="sr-only">. {detail}</span>
    </span>
  );
}
