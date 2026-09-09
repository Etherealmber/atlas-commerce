/** Lightweight inline SVG icons — no emoji */
import type { ReactElement } from 'react';

type IconProps = {
  size?: number;
  className?: string;
  title?: string;
};

const svgProps = (size: number, className?: string, title?: string) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  className,
  role: title ? ('img' as const) : ('presentation' as const),
  'aria-hidden': title ? undefined : true,
  'aria-label': title,
});

export function IconDocument({ size = 24, className, title }: IconProps) {
  return (
    <svg {...svgProps(size, className, title)}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M8 13h8M8 17h6" />
    </svg>
  );
}

export function IconPackage({ size = 24, className, title }: IconProps) {
  return (
    <svg {...svgProps(size, className, title)}>
      <path d="M21 8l-9-5-9 5v8l9 5 9-5V8z" />
      <path d="M3 8l9 5 9-5" />
      <path d="M12 13v8" />
    </svg>
  );
}

export function IconUser({ size = 24, className, title }: IconProps) {
  return (
    <svg {...svgProps(size, className, title)}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
    </svg>
  );
}

export function IconUsers({ size = 24, className, title }: IconProps) {
  return (
    <svg {...svgProps(size, className, title)}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 19c0-3.2 2.9-5.5 6.5-5.5" />
      <circle cx="16.5" cy="9" r="3" />
      <path d="M12 19c0-2.8 2.2-5 5-5s4.5 1.5 5 4" />
    </svg>
  );
}

export function IconReceipt({ size = 24, className, title }: IconProps) {
  return (
    <svg {...svgProps(size, className, title)}>
      <path d="M6 3h12v18l-2-1.5L14 21l-2-1.5L10 21l-2-1.5L6 21V3z" />
      <path d="M9 8h6M9 12h6M9 16h4" />
    </svg>
  );
}

export function IconQuote({ size = 24, className, title }: IconProps) {
  return (
    <svg {...svgProps(size, className, title)}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M9 13h.01M12 13h.01M15 13h.01" />
      <path d="M8 17h5" />
    </svg>
  );
}

export function IconWallet({ size = 24, className, title }: IconProps) {
  return (
    <svg {...svgProps(size, className, title)}>
      <path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
      <path d="M16 12h5v3h-5a1.5 1.5 0 0 1 0-3z" />
      <path d="M3 10h18" />
    </svg>
  );
}

export function IconChart({ size = 24, className, title }: IconProps) {
  return (
    <svg {...svgProps(size, className, title)}>
      <path d="M4 19h16" />
      <path d="M7 16V9M12 16V5M17 16v-6" />
    </svg>
  );
}

export function IconInbox({ size = 24, className, title }: IconProps) {
  return (
    <svg {...svgProps(size, className, title)}>
      <path d="M4 13h4l2 3h4l2-3h4" />
      <path d="M4 13l2-8h12l2 8v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-5z" />
    </svg>
  );
}

export function IconBuilding({ size = 24, className, title }: IconProps) {
  return (
    <svg {...svgProps(size, className, title)}>
      <path d="M4 21V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v16" />
      <path d="M14 10h5a1 1 0 0 1 1 1v10" />
      <path d="M8 8h2M8 12h2M8 16h2M17 14h1M17 17h1" />
      <path d="M3 21h18" />
    </svg>
  );
}

export function IconCheck({ size = 24, className, title }: IconProps) {
  return (
    <svg {...svgProps(size, className, title)}>
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}

export function IconSearch({ size = 24, className, title }: IconProps) {
  return (
    <svg {...svgProps(size, className, title)}>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}

export type EmptyIconName =
  | 'document'
  | 'package'
  | 'user'
  | 'users'
  | 'receipt'
  | 'quote'
  | 'wallet'
  | 'chart'
  | 'inbox'
  | 'building'
  | 'search'
  | 'check';

const MAP: Record<EmptyIconName, (p: IconProps) => ReactElement> = {
  document: IconDocument,
  package: IconPackage,
  user: IconUser,
  users: IconUsers,
  receipt: IconReceipt,
  quote: IconQuote,
  wallet: IconWallet,
  chart: IconChart,
  inbox: IconInbox,
  building: IconBuilding,
  search: IconSearch,
  check: IconCheck,
};

export function EmptyIcon({ name, size = 40 }: { name: EmptyIconName; size?: number }) {
  const Comp = MAP[name] || IconDocument;
  return <Comp size={size} />;
}
