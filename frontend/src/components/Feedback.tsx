/** Shared loading, empty and error presentations. */

import type { ReactNode } from 'react';

import { AlertIcon, SpinnerIcon } from './Icons';

export function LoadingBlock({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-stone-500" role="status">
      <SpinnerIcon className="h-5 w-5" />
      <span>{label}</span>
    </div>
  );
}

/** Grey placeholders matching the menu grid, to avoid a layout jump on load. */
export function MenuSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div
      className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3"
      aria-hidden="true"
      data-testid="menu-skeleton"
    >
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="card overflow-hidden">
          <div className="aspect-[4/3] animate-pulse bg-stone-200" />
          <div className="space-y-3 p-4">
            <div className="h-4 w-2/3 animate-pulse rounded bg-stone-200" />
            <div className="h-3 w-full animate-pulse rounded bg-stone-100" />
            <div className="h-3 w-4/5 animate-pulse rounded bg-stone-100" />
            <div className="h-10 w-full animate-pulse rounded-full bg-stone-100" />
          </div>
        </div>
      ))}
    </div>
  );
}

interface ErrorBlockProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}

export function ErrorBlock({
  title = 'Something went wrong',
  message,
  onRetry,
  retryLabel = 'Try again',
}: ErrorBlockProps) {
  return (
    <div className="card border-red-200 bg-red-50 p-6" role="alert">
      <div className="flex gap-3">
        <AlertIcon className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
        <div>
          <p className="font-semibold text-red-900">{title}</p>
          <p className="mt-1 text-sm text-red-800">{message}</p>
          {onRetry && (
            <button type="button" onClick={onRetry} className="btn-secondary mt-4 py-2 text-sm">
              {retryLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  message: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, message, action }: EmptyStateProps) {
  return (
    <div className="card flex flex-col items-center px-6 py-14 text-center">
      {icon && <div className="mb-4 text-stone-300">{icon}</div>}
      <p className="text-lg font-semibold text-stone-900">{title}</p>
      <p className="mt-1.5 max-w-sm text-sm text-stone-600">{message}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
