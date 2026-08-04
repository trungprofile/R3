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
import { EmptyState, ErrorBlock, List, SkeletonRows } from '../../../components/index.ts';
import {
  buildPath,
  todayInZone,
  useAsyncData,
  useRouter,
  useSession,
  useToast,
} from '../../../app/index.ts';
import type { ScreenProps } from '../../../app/index.ts';
import type { ReceiveDonationSummary, ReceiveRunSummary } from '../../../api/shared.ts';
import { fetchDonationSummary, fetchReceivableRuns, fetchRunStops } from './api.ts';
import { setReportable } from '../s2-3-donation/api.ts';
import { messageFor } from '../s2-3-donation/donation.ts';
import { COPY, listState, targetForStops, toBands, toDonationPanel } from './run-picker.ts';
import type { RunCardView } from './run-picker.ts';
import { DonationPanel } from './DonationPanel.tsx';
import { RunCard } from './RunCard.tsx';
import { RunTile } from './RunTile.tsx';
import './run-picker.css';

export function RunPickerScreen(_props: ScreenProps) {
  // The pantry's zone (A120), used for the CLOCK — and, since `D38`, for the one
  // calendar comparison this screen makes: which band a run falls into. Neither is
  // the device's. Every date the receiver READS is still the run's own
  // `occurrenceDate` — see the date rule at the top of `run-picker.ts`.
  const { timezone } = useSession();
  const { navigate } = useRouter();
  const toast = useToast();

  const load = useCallback((signal: AbortSignal) => fetchReceivableRuns(signal), []);
  const state = useAsyncData<ReceiveRunSummary[]>(load);
  // `D67`. A separate call on purpose: a walk-in belongs to no run, and a failure
  // here must not take the run list down with it — the panel falls back to its
  // heading and its walk-in button, which is still the only route to S2.3.
  const loadDonations = useCallback((signal: AbortSignal) => fetchDonationSummary(signal), []);
  const donations = useAsyncData<ReceiveDonationSummary>(loadDonations);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [donationBusy, setDonationBusy] = useState(false);
  // `D38`: closed by default. Nothing is removed from the screen, only folded —
  // one tap has all of it back.
  const [laterOpen, setLaterOpen] = useState(false);
  // `D66`'s band, same treatment: folded, never dropped.
  const [lapsedOpen, setLapsedOpen] = useState(false);
  const [closedOpen, setClosedOpen] = useState(false);

  const bands = useMemo(
    () => toBands(state.data ?? [], todayInZone(timezone), timezone),
    [state.data, timezone],
  );
  const view = listState(state.data, state.error, state.showLoading);
  const donationPanel = useMemo(() => toDonationPanel(donations.data), [donations.data]);

  /**
   * Flip a recorded donation's report flag (I15, PRD cap 15).
   *
   * Re-reads rather than patching the row in place: this screen holds no donation
   * state of its own, and on a shared tablet the list it is looking at may already
   * have moved. One extra fetch on a rare tap is cheaper than a second source of
   * truth for the same rows.
   */
  async function toggleReport(id: string) {
    const row = donations.data?.recorded.find((candidate) => candidate.id === id);
    if (!row) return;
    setDonationBusy(true);
    try {
      await setReportable(id, !row.reportable);
      donations.reload();
    } catch (error) {
      toast.error(messageFor(error));
    } finally {
      setDonationBusy(false);
    }
  }

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
      const fresh = targetForStops(
        card.run.shiftId,
        await fetchRunStops(card.run.shiftId),
        // `D66`: a fresher stop list does not reopen a closed window, so a lapsed
        // run still lands on S2.2b rather than on a sheet that refuses every write.
        card.run.editWindowOpen,
      );
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
        <section className="s21b__bands" aria-label={COPY.listLabel}>
          {/* Band 1 (`D38`) — what the receiver is actually waiting for, as large
              cards. First on the screen and largest on it, because the question the
              screen asks is "which run are you receiving?" and these are the only
              answers to it. */}
          {bands.expected.length > 0 ? (
            <div className="s21b__band">
              <h2 className="s21b__band-title">{COPY.bandExpected}</h2>
              <ul className="s21b-tiles" aria-label={COPY.bandExpected}>
                {bands.expected.map((card) => (
                  <li key={card.run.shiftId}>
                    <RunTile
                      card={card}
                      busy={busyId === card.run.shiftId}
                      onOpen={() => void openRun(card)}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Band 2 — weighed through, waiting on the tap that closes them (I11).
              Rows, as they always were: done, but worth seeing. */}
          {bands.finished.length > 0 ? (
            <div className="s21b__band">
              <h2 className="s21b__band-title">{COPY.bandFinished}</h2>
              <List label={COPY.bandFinished}>
                {bands.finished.map((card) => (
                  <RunCard
                    key={card.run.shiftId}
                    card={card}
                    busy={busyId === card.run.shiftId}
                    onOpen={() => void openRun(card)}
                  />
                ))}
              </List>
            </div>
          ) : null}

          {/* Band 3 — folded away, never dropped. The heading carries the count so
              the receiver can see there is something behind it without opening it. */}
          {bands.later.length > 0 ? (
            <div className="s21b__band">
              <button
                type="button"
                className="s21b__disclosure"
                aria-expanded={laterOpen}
                onClick={() => setLaterOpen((open) => !open)}
              >
                {COPY.bandLaterCount(bands.later.length)}
              </button>
              {laterOpen ? (
                <List label={COPY.bandLater}>
                  {bands.later.map((card) => (
                    <RunCard
                      key={card.run.shiftId}
                      card={card}
                      busy={busyId === card.run.shiftId}
                      onOpen={() => void openRun(card)}
                    />
                  ))}
                </List>
              ) : null}
            </div>
          ) : null}

          {/* Band 4 (`D66`) — past the receiver's edit window. Folded like band 3
              and, like it, never dropped: `receiveDone` is not window-gated and
              this list is its only route, so hiding these would leave them
              IN_PROGRESS with nothing able to close them (A162). Last on the
              screen because there is no weighing left in it. */}
          {bands.lapsed.length > 0 ? (
            <div className="s21b__band">
              <button
                type="button"
                className="s21b__disclosure"
                aria-expanded={lapsedOpen}
                onClick={() => setLapsedOpen((open) => !open)}
              >
                {COPY.bandLapsedCount(bands.lapsed.length)}
              </button>
              {lapsedOpen ? (
                <List label={COPY.bandLapsed}>
                  {bands.lapsed.map((card) => (
                    <RunCard
                      key={card.run.shiftId}
                      card={card}
                      busy={busyId === card.run.shiftId}
                      onOpen={() => void openRun(card)}
                    />
                  ))}
                </List>
              ) : null}
            </div>
          ) : null}

          {/* Closed today, read-only. Receive-done used to make a run disappear at
              the moment it was confirmed, which is exactly when a receiver wants
              another look at what they just weighed. Collapsed, and last: it is a
              record of the shift, not a part of it. Bounded to the pantry's today
              by the server — anything older belongs to the report. */}
          {bands.closed.length > 0 ? (
            <div className="s21b__band">
              <button
                type="button"
                className="s21b__disclosure"
                aria-expanded={closedOpen}
                onClick={() => setClosedOpen((open) => !open)}
              >
                {COPY.bandClosedCount(bands.closed.length)}
              </button>
              {closedOpen ? (
                <List label={COPY.bandClosed}>
                  {bands.closed.map((card) => (
                    <RunCard
                      key={card.run.shiftId}
                      card={card}
                      busy={busyId === card.run.shiftId}
                      onOpen={() => void openRun(card)}
                    />
                  ))}
                </List>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {/* S2.1b: "[ Unscheduled donation ] (goes to S2.3, no run needed)".
          It stays on screen in every state, including the empty one, because it is
          the one thing a receiver can do when no run is listed — and it is now also
          the ONLY route to S2.3, since `D30` took the nav entry, so "visible in
          every state" stopped being a courtesy and became the reason that screen is
          reachable at all.

          Outside the bands on purpose (`D38`): none of these is a run, so they
          belong to no group of them and must not fold away when a band empties.

          `D67` grew it from a bare button into a card; `D76` grew it again into the
          two lists it now holds, because a driver's flag is work arriving and the
          picker is where a receiver reads what has arrived. The rationale is on
          `DonationPanel.tsx`. */}
      <DonationPanel
        view={donationPanel}
        busy={donationBusy}
        onWeigh={(id) => navigate(buildPath('donation-weigh', { id }))}
        onAddWalkIn={() => navigate(buildPath('donation'))}
        onToggleReport={(id) => void toggleReport(id)}
      />
    </div>
  );
}
