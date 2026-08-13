/**
 * Inline SVG icons.
 *
 * Hand-rolled rather than pulled from an icon package: the app needs eight
 * glyphs, and a dependency would ship thousands. Every icon is
 * `aria-hidden` -- the surrounding control carries the accessible name.
 */

interface IconProps {
  className?: string;
}

function base(className?: string): string {
  return `h-5 w-5 ${className ?? ''}`.trim();
}

export function CartIcon({ className }: IconProps) {
  return (
    <svg
      className={base(className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 4h2l2.4 11.2A2 2 0 0 0 9.36 17h8.28a2 2 0 0 0 1.96-1.6L21 8H6" />
      <circle cx="10" cy="20" r="1.4" />
      <circle cx="18" cy="20" r="1.4" />
    </svg>
  );
}

export function PlusIcon({ className }: IconProps) {
  return (
    <svg
      className={base(className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function MinusIcon({ className }: IconProps) {
  return (
    <svg
      className={base(className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M5 12h14" />
    </svg>
  );
}

export function TrashIcon({ className }: IconProps) {
  return (
    <svg
      className={base(className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

export function CheckIcon({ className }: IconProps) {
  return (
    <svg
      className={base(className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 12.5l5 5L20 6.5" />
    </svg>
  );
}

export function ChefIcon({ className }: IconProps) {
  return (
    <svg
      className={base(className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 12a3.5 3.5 0 1 1 1.2-6.8A3.6 3.6 0 0 1 12 3.4a3.6 3.6 0 0 1 4.8 1.8A3.5 3.5 0 1 1 18 12z" />
      <path d="M7 12v6a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-6" />
      <path d="M10 16h4" />
    </svg>
  );
}

export function ScooterIcon({ className }: IconProps) {
  return (
    <svg
      className={base(className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="5.5" cy="17.5" r="2.5" />
      <circle cx="18.5" cy="17.5" r="2.5" />
      <path d="M8 17.5h8M14 5h3l2 8" />
      <path d="M14 5v9" />
    </svg>
  );
}

export function ReceiptIcon({ className }: IconProps) {
  return (
    <svg
      className={base(className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
      <path d="M9 8h6M9 12h6" />
    </svg>
  );
}

export function AlertIcon({ className }: IconProps) {
  return (
    <svg
      className={base(className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v6M12 16.5h.01" />
    </svg>
  );
}

export function SearchIcon({ className }: IconProps) {
  return (
    <svg
      className={base(className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4 4" />
    </svg>
  );
}

export function SpinnerIcon({ className }: IconProps) {
  return (
    <svg
      className={`${base(className)} animate-spin`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
