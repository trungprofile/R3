// The start step — "one big step — pick a truck (list)" (S1.5).
//
// The route is already bound (staff bound it at scheduling, S1.6) and the driver
// is known from sign-in, so a truck is the only thing left to choose. Starting is
// what takes the I5 snapshot and moves `CLAIMED → IN_PROGRESS`, both server-side
// and both in one transaction — this screen sends one request and replaces the
// run with what comes back.
//
// Pick-then-start rather than pick-and-go: the ShiftStop machine has no way back,
// a started run cannot be un-started, and a mis-tap in a moving truck would
// otherwise start the run on the wrong truck with nothing to undo it with. Two
// taps, one primary action (§1.1).

import { useState } from 'react';
import { useAsyncData, useToast } from '../../../app/index.ts';
import { Button, EmptyState, ErrorBlock, SkeletonRows } from '../../../components/index.ts';
import type { RunDetail } from '../../../api/shared.ts';
import { fetchTrucks, startRun } from './api.ts';
import { COPY, messageFor, selectableTrucks, truckLabel } from './logic.ts';

export interface StartStepProps {
  run: RunDetail;
  onStarted: (run: RunDetail) => void;
}

export function StartStep({ run, onStarted }: StartStepProps) {
  const toast = useToast();
  const trucks = useAsyncData(fetchTrucks);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const start = async () => {
    if (!selectedId) return;
    setStarting(true);
    try {
      onStarted(await startRun(run.shiftId, selectedId));
    } catch (error) {
      toast.error(messageFor(error));
    } finally {
      setStarting(false);
    }
  };

  const list = trucks.data ? selectableTrucks(trucks.data) : [];

  return (
    <>
      <header className="r3-pickup__head">
        <h1>{run.routeName}</h1>
      </header>

      {run.staffNote ? (
        // Cap 11 channel 1: coordinator → driver, read-only here (S1.3 is where
        // staff write it).
        <section className="r3-pickup__staff-note" aria-label={COPY.staffNoteLabel}>
          <p className="r3-pickup__label">{COPY.staffNoteLabel}</p>
          <p>{run.staffNote}</p>
        </section>
      ) : null}

      <h2>{COPY.pickTruck}</h2>
      <p className="r3-pickup__hint">{COPY.pickTruckHint}</p>

      {trucks.error ? <ErrorBlock error={trucks.error} onRetry={trucks.reload} /> : null}
      {!trucks.error && !trucks.data && trucks.showLoading ? <SkeletonRows rows={3} /> : null}
      {trucks.data && list.length === 0 ? (
        <EmptyState title={COPY.noTrucks}>{COPY.noTrucksNext}</EmptyState>
      ) : null}

      {list.length > 0 ? (
        <div className="r3-truck-list" role="radiogroup" aria-label={COPY.pickTruck}>
          {list.map((truck) => {
            const chosen = truck.id === selectedId;
            return (
              <button
                key={truck.id}
                type="button"
                role="radio"
                aria-checked={chosen}
                className={`r3-truck${chosen ? ' r3-truck--chosen' : ''}`}
                onClick={() => setSelectedId(truck.id)}
              >
                <span className="r3-truck__name">{truckLabel(truck)}</span>
                <span className="r3-truck__mark" aria-hidden="true" />
              </button>
            );
          })}
        </div>
      ) : null}

      {list.length > 0 ? (
        <div className="r3-pickup__primary">
          {/* Stays visible while unusable: hiding it would leave the screen with
              no statement of what the taps lead to (§3 disabled-vs-hidden). */}
          <Button
            variant="primary"
            block
            disabled={selectedId === null}
            loading={starting}
            onClick={() => void start()}
          >
            {COPY.startRun}
          </Button>
        </div>
      ) : null}
    </>
  );
}
