// One way to load a list, so every screen gets §6's three states right.
//
// `ui-ux-spec.md §3`: "every list defines all three" — empty, loading, error.
// This hook returns them as one value, with the 300ms delay already applied to
// the loading flag, so a screen renders:
//
//   if (state.showLoading) return <SkeletonRows />;
//   if (state.error) return <ErrorBlock error={state.error} onRetry={state.reload} />;
//   if (state.data.length === 0) return <EmptyState … />;
//
// It does not retry on its own. §6 makes retry a visible, user-initiated
// affordance ("Tap to try again"), never a silent loop behind a spinner.

import { useCallback, useEffect, useState } from 'react';
import { useDelayedLoading } from '../components/index.ts';

export interface AsyncData<T> {
  data: T | null;
  error: unknown;
  /** True only after the load has been running 300ms (§6). */
  showLoading: boolean;
  reload: () => void;
}

export function useAsyncData<T>(load: (signal: AbortSignal) => Promise<T>): AsyncData<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const showLoading = useDelayedLoading(loading);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    load(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setData(result);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [load, attempt]);

  const reload = useCallback(() => setAttempt((current) => current + 1), []);

  return { data, error, showLoading, reload };
}
