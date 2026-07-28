// Loading / empty / error — `ui-ux-spec.md §3` ("every list defines all three")
// and the patterns in §6.
//
// These three exist as components rather than as advice because the spec's rules
// are easy to lose one screen at a time:
//   - LOADING is skeleton rows, never a bare spinner on a blank screen, and
//     nothing shows at all under 300ms (`useDelayedLoading`).
//   - EMPTY says what to do next, not "nothing here".
//   - ERROR is plain and recoverable, with a retry, and NEVER a code. The
//     correlation identifier from the server (`architecture.md §5.5`) is for the
//     operator reading logs and never reaches the screen.

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from './Button.tsx';
import { toApiError } from '../api/errors.ts';
import { duration } from '../tokens/index.ts';

/** True only once `active` has held for 300ms — §6: "Sub-300ms actions show
 *  nothing." Wrapping every list fetch in this is what stops the board flashing
 *  a skeleton on a fast local network. */
export function useDelayedLoading(active: boolean, delayMs: number = duration.loadingDelayMs) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!active) {
      setVisible(false);
      return;
    }
    const timer = setTimeout(() => setVisible(true), delayMs);
    return () => clearTimeout(timer);
  }, [active, delayMs]);

  return visible;
}

/** Skeleton rows sized like the real ones, so the list does not jump. */
export function SkeletonRows({ rows = 4, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, index) => (
        <div className="r3-skeleton-row" key={index}>
          <div
            className="r3-skeleton-bar"
            style={{ width: index % 2 === 0 ? '60%' : '45%' }}
            aria-hidden="true"
          />
        </div>
      ))}
    </div>
  );
}

export interface EmptyStateProps {
  /** What is not here, e.g. "No open runs right now." */
  title: string;
  /** What to do next. §6: instructive, never just "nothing here". */
  children?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ title, children, action }: EmptyStateProps) {
  return (
    <div className="r3-block">
      <p className="r3-block__title">{title}</p>
      {children ? <p className="r3-block__body">{children}</p> : null}
      {action}
    </div>
  );
}

export interface ErrorBlockProps {
  /** Anything thrown. Turned into the one plain message shape. */
  error: unknown;
  onRetry?: () => void;
}

export function ErrorBlock({ error, onRetry }: ErrorBlockProps) {
  const apiError = toApiError(error);
  const canRetry = onRetry !== undefined && apiError.retryable;

  return (
    <div className="r3-block" role="alert">
      <p className="r3-block__title">{apiError.message}</p>
      {canRetry ? (
        <Button variant="primary" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}
