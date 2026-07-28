// Button — `ui-ux-spec.md §3`.
//
// Three variants and no more: primary (orange fill, dark label), secondary
// (white, border), danger (red fill, white). §1 principle 1 allows exactly one
// primary per screen; that is the screen's job to honour, not something this
// component can check.
//
// A disabled button is greyed, but §3 prefers hiding over disabling — reach for
// `disabled` only when the control must stay visible to make sense of the screen.
// Hiding an action the server would refuse is a courtesy to the user, never the
// rule itself: every rule is enforced again server-side (`architecture.md §4.5`).

import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'danger';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: ButtonVariant;
  /** Full-width — the phone default for a screen's one primary action. */
  block?: boolean;
  /** Waiting on the server. Blocks re-submission and announces it politely. */
  loading?: boolean;
  children: ReactNode;
}

export function Button({
  variant = 'secondary',
  block = false,
  loading = false,
  disabled = false,
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  const classes = ['r3-btn', `r3-btn--${variant}`];
  if (block) classes.push('r3-btn--block');

  return (
    <button
      {...rest}
      type={type}
      className={classes.join(' ')}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {children}
    </button>
  );
}
