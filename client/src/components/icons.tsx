// The icon set. Inline SVG, no icon dependency (dependencies are Wave-0-owned,
// build-plan §3/D5) and none needed for a dozen glyphs.
//
// Icons are never the only label: §3 requires "icon + label always (no
// icon-only)" in the bottom nav, and every icon-only control elsewhere carries a
// visually hidden name. Colour comes from `currentColor`, so an icon inside an
// active nav item picks up the orange accent without a second rule.

interface IconProps {
  /** In `em`, so an icon scales with the text beside it at 200% zoom (§1.3). */
  size?: string;
  className?: string;
}

function svgProps(size: string, className?: string) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: false,
    ...(className ? { className } : {}),
  };
}

/** The AGFP heart — the one decorative brand mark, in `--brand-orange` (§2). */
export function HeartIcon({ size = '1.5em', className }: IconProps) {
  return (
    <svg {...svgProps(size, className)} fill="currentColor" stroke="none">
      <path d="M12 20.5 4.2 13a4.7 4.7 0 0 1 0-6.7 4.7 4.7 0 0 1 6.6 0l1.2 1.2 1.2-1.2a4.7 4.7 0 0 1 6.6 0 4.7 4.7 0 0 1 0 6.7Z" />
    </svg>
  );
}

/** Board — the shared shift board (S1.2). */
export function BoardIcon({ size = '1.5em', className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M4 6h16M4 12h16M4 18h10" />
    </svg>
  );
}

/** My shifts (S1.4). */
export function CalendarIcon({ size = '1.5em', className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}

/** Inbox (S1.9) and the top-bar bell. */
export function BellIcon({ size = '1.5em', className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M18 9a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6" />
      <path d="M13.7 20a2 2 0 0 1-3.4 0" />
    </svg>
  );
}

/** Schedule (S1.6 / S1.7). */
export function ClockIcon({ size = '1.5em', className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

/** Admin (S1.8). */
export function PeopleIcon({ size = '1.5em', className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16 5.2a3.5 3.5 0 0 1 0 6.6M17.5 14.4A6.5 6.5 0 0 1 21.5 20" />
    </svg>
  );
}

/** Report (S3.1). */
export function DocumentIcon({ size = '1.5em', className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </svg>
  );
}

/** Metrics (S3.2). */
export function ChartIcon({ size = '1.5em', className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </svg>
  );
}

export function BackspaceIcon({ size = '1.5em', className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M9 5h11a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H9l-6-7Z" />
      <path d="M12 10l5 4M17 10l-5 4" />
    </svg>
  );
}

export function ChevronRightIcon({ size = '1.5em', className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M9 5l7 7-7 7" />
    </svg>
  );
}

export function WarningIcon({ size = '1.5em', className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M12 4 2.5 20h19Z" />
      <path d="M12 10v4M12 17.5v.01" />
    </svg>
  );
}
