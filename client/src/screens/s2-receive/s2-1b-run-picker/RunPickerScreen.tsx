// S2.1b — the run picker. Where a receiver at the shared tablet lands (A167).
//
// "Purpose: resolve which shift/run today's weighing belongs to, since
// `weight_entry.shift_id` is required and a store can be one stop among several on
// a driver's run." So the screen asks one question and offers three answers: a run
// to weigh, a run to close out, or a donation that came with no run at all.
//
// Canonical device is the shared tablet in LANDSCAPE. The responsive matrix marks
// weight entry `n/a` on a phone, so this screen has no phone layout — it is built
// for 1024×768 and degrades to a single column on anything narrower rather than
// pretending to be a phone screen.
//
// The rules it renders are the SERVER's. `readyForReceiveDone` is the completion
// gate's own answer (I12), the list's membership is `listReceivableRuns()`'s (A162),
// and every one of them is checked again on the request that matters
// (`architecture.md §4.5`). Nothing below decides what may be received.

import { useCallback, useMemo, useState } from 'react';
import { Button, EmptyState, ErrorBlock, List, SkeletonRows } from '../../../components/index.ts';
import { buildPath, useAsyncData, useRouter, useSession } from '../../../app/index.ts';
import type { ScreenProps } from '../../../app/index.ts';
import type { ReceiveRunSummary } from '../../../api/shared.ts';
import { fetchReceivableRuns, fetchRunStops } from './api.ts';
import { COPY, listState, targetForStops, toCards } from './run-picker.ts';
import type { RunCardView } from './run-picker.ts';
import { RunCard } from './RunCard.tsx';
import './run-picker.css';

export function RunPickerScreen(_props: ScreenProps) {
  // The pantry's zone (A120), used for the CLOCK only. Every date on this screen
  // comes from the run's own `occurrenceDate` and never from a device clock — see
  // the date rule at the top of `run-picker.ts`.
  const { timezone } = useSession();
  const { navigate } = useRouter();

  const load = useCallback((signal: AbortSignal) => fetchReceivableRuns(signal), []);
  const state = useAsyncData<ReceiveRunSummary[]>(load);
  const [busyId, setBusyId] = useState<string | null>(null);

  const cards = useMemo(() => toCards(state.data ?? [], timezone), [state.data, timezone]);
  const view = listState(state.data, state.error, state.showLoading);

  /**
   * Open a run.
   *
   * The stop list is re-read first, because S2.1b lets several receivers work the
   * same run's different stops at once: the card may be pointing at a store the
   * person at the other counter weighed a minute ago. If the re-read fails, the tap
   * still lands on the stop the card had — the server is what decides whether that
   * stop may be weighed, so a stale target is a wasted step and never a wrong write.
   */
  async function openRun(card: RunCardView) {
    if (!card.target) return;
    let target = card.target;
    setBusyId(card.run.shiftId);
    try {
      const fresh = targetForStops(card.run.shiftId, await fetchRunStops(card.run.shiftId));
      if (fresh) target = fresh;
    } catch {
      // Deliberately silent: nothing failed for the receiver, and the run reload
      // below would raise anything that actually matters.
    } finally {
      setBusyId(null);
    }
    navigate(buildPath(target.screen, target.params));
  }

  return (
    <div className="s21b">
      <h1 className="s21b__title">{COPY.header}</h1>

      {view === 'LOADING' ? <SkeletonRows rows={3} label={COPY.loading} /> : null}
      {view === 'ERROR' ? <ErrorBlock error={state.error} onRetry={state.reload} /> : null}
      {view === 'EMPTY' ? (
        <EmptyState title={COPY.emptyTitle}>{COPY.emptyBody}</EmptyState>
      ) : null}
      {view === 'RUNS' ? (
        <List label={COPY.listLabel}>
          {cards.map((card) => (
            <RunCard
              key={card.run.shiftId}
              card={card}
              busy={busyId === card.run.shiftId}
              onOpen={() => void openRun(card)}
            />
          ))}
        </List>
      ) : null}

      {/* S2.1b: "[ Unscheduled donation ] (goes to S2.3, no run needed)". It stays
          on screen in every state, including the empty one, because it is the one
          thing a receiver can do when no run is listed — and it is `secondary`, not
          primary: §1's one high-emphasis action per screen belongs to picking a
          run, which is the question the screen asks. */}
      <div className="s21b__aside">
        <Button variant="secondary" onClick={() => navigate(buildPath('donation'))}>
          {COPY.unscheduled}
        </Button>
      </div>
    </div>
  );
}
