// Typed access to the design tokens (`ui-ux-spec.md §2`).
//
// These are REFERENCES (`var(--brand-orange)`), not copies of the values. The
// values live in `tokens.css` and only there, so a component that reaches for a
// token in an inline style cannot drift from the stylesheet.
//
// If you need a colour, a step of the type scale, a spacing step or a target
// size, it is here. Do not write a literal hex or px in a component.

import './tokens.css';

export const color = {
  brandOrange: 'var(--brand-orange)',
  brandGold: 'var(--brand-gold)',
  text: 'var(--text)',
  textMuted: 'var(--text-muted)',
  textOnBrand: 'var(--text-on-brand)',
  textOnDark: 'var(--text-on-dark)',
  actionFill: 'var(--action-fill)',
  link: 'var(--link)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  surface: 'var(--surface)',
  surfacePaper: 'var(--surface-paper)',
  structuralDark: 'var(--structural-dark)',
  border: 'var(--border)',
} as const;

export const font = {
  body: 'var(--font-body)',
  label: 'var(--font-label)',
  h3: 'var(--font-h3)',
  h2: 'var(--font-h2)',
  h1: 'var(--font-h1)',
  numeric: 'var(--font-numeric)',
} as const;

export const space = {
  1: 'var(--space-1)',
  2: 'var(--space-2)',
  3: 'var(--space-3)',
  4: 'var(--space-4)',
  5: 'var(--space-5)',
  6: 'var(--space-6)',
  7: 'var(--space-7)',
  screenPadding: 'var(--screen-padding)',
} as const;

export const radius = {
  control: 'var(--radius-control)',
  card: 'var(--radius-card)',
  pill: 'var(--radius-pill)',
} as const;

export const size = {
  targetMin: 'var(--target-min)',
  rowMin: 'var(--row-min)',
  keyMin: 'var(--key-min)',
  inputHeight: 'var(--input-height)',
  bottomNavHeight: 'var(--bottom-nav-height)',
  topBarHeight: 'var(--top-bar-height)',
  sideNavWidth: 'var(--side-nav-width)',
} as const;

// Durations the interaction patterns (§6) are specified in. Numbers, because
// they are used as timer arguments in TypeScript rather than in CSS.
export const duration = {
  /** §6: "Sub-300ms actions show nothing." Loading UI waits this long first. */
  loadingDelayMs: 300,
  /** §3: toast is bottom, 4s. */
  toastMs: 4000,
  /** §5: a 30s "Still here?" prompt before an inactivity timeout logs you out. */
  idlePromptMs: 30_000,
} as const;

// Viewport classes. §0 maps each device to a surface and §4 gives each a nav;
// the spec states no pixel breakpoints, so these are ours (see report
// `Assumed:`): phone < 768, tablet 768–1199, desktop >= 1200.
//
// D36 moved the desktop edge up from 1024. Every current iPad in landscape sits
// between 1024 and 1194, so the old number handed a receiving dock the desktop
// left sidebar and left the screen it was reading squeezed into what remained.
// The tablet edge does NOT move with it — 768 is still where a phone stops.
export const breakpoint = {
  tabletMinPx: 768,
  desktopMinPx: 1200,
} as const;
