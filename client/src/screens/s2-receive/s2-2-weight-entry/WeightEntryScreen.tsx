// S2.2 Weight entry — the Retail Rescue Log, on the shared tablet.
//
// One screen = one run + one stop + this receiver (S2.2). The mental model is the
// paper sheet it replaces: category columns, the numbers written under them, and
// a total that adds itself up. Everything else on the screen is context the sheet
// needed to stop being paper — which stop, which run, and the driver's notes.
//
// The canonical device is the shared tablet in LANDSCAPE. The responsive matrix
// marks weight entry `n/a` on a phone, so there is no phone layout here and the
// CSS does not pretend otherwise; it works on a desktop because a coordinator
// occasionally weighs at one.
//
// WHAT THIS SCREEN DOES NOT DECIDE:
//   - `WEIGHED` — derived from a non-voided weight existing (I12), never set from
//     here. "Mark stop weighed" navigates; it does not write.
//   - how a correction is stored — void-old + insert-new (I13). The receiver sees
//     an overwrite, and that word never appears.
//   - closing the run — Receive done is the one completion action (I11) and it is
//     the next screen along (S2.2b).
//
// Every mutation returns the whole refreshed sheet, so the screen re-renders from
// the server rather than patching totals locally: two receivers may be weighing
// different stops of this run at the same time (S2.1b).

import { useCallback, useEffect, useState } from 'react';
import { useAsyncData, useRouter, useToast } from '../../../app/index.ts';
import type { ScreenProps } from '../../../app/index.ts';
import {
  Button,
  ConfirmModal,
  EmptyState,
  ErrorBlock,
  SkeletonRows,
} from '../../../components/index.ts';
import type {
  ReceiveStopDetail,
  ReceiveStopSummary,
  WeightEntrySummary,
} from '../../../api/shared.ts';
import {
  addWeight,
  fetchRunStops,
  fetchStopSheet,
  removeWeight,
  reviseWeight,
  skipStop,
} from './api.ts';
import { CategoryTile } from './CategoryTile.tsx';
import { ClosedPanel, KeypadPanel } from './KeypadPanel.tsx';
import type { EditingEntry } from './KeypadPanel.tsx';
import { StopNotes } from './StopNotes.tsx';
import { StopStrip } from './StopStrip.tsx';
import {
  COPY,
  acceptKeypadValue,
  advanceTargetFor,
  allStopsResolved,
  applyStopState,
  canAddWeight,
  formatWeight,
  leaveDecision,
  messageFor,
  normalizeWeight,
  orderedTiles,
  sheetIsOpen,
  shouldReloadAfter,
} from './weight-entry.ts';
import type { AdvanceTarget } from './weight-entry.ts';
import './weight-entry.css';

/** Somewhere else to be. Held rather than followed while a number sits unadded
 *  on the keypad — S2.2's edge case is that leaving mid-entry warns. */
type LeaveTarget = { kind: 'stop'; stopId: string } | { kind: 'receive-done' } | { kind: 'runs' };

export function WeightEntryScreen({ params }: ScreenProps) {
  const shiftId = params['shiftId'] ?? '';
  const stopId = params['stopId'] ?? '';
  const { go } = useRouter();
  const toast = useToast();

  const loadSheet = useCallback(
    (signal: AbortSignal): Promise<ReceiveStopDetail | null> =>
      stopId === '' ? Promise.resolve(null) : fetchStopSheet(shiftId, stopId, signal),
    [shiftId, stopId],
  );
  const loadStrip = useCallback(
    (signal: AbortSignal): Promise<ReceiveStopSummary[]> =>
      shiftId === '' ? Promise.resolve([]) : fetchRunStops(shiftId, signal),
    [shiftId],
  );
  const sheet = useAsyncData<ReceiveStopDetail | null>(loadSheet);
  const strip = useAsyncData<ReceiveStopSummary[]>(loadStrip);

  const [detail, setDetail] = useState<ReceiveStopDetail | null>(null);
  const [stops, setStops] = useState<ReceiveStopSummary[]>([]);
  const [entry, setEntry] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditingEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState<LeaveTarget | null>(null);
  const [confirmingSkip, setConfirmingSkip] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  // A different stop is a different sheet. Clear what the old one held before the
  // new numbers arrive, so no subtotal from the last store is ever on screen
  // under this store's name.
  useEffect(() => {
    setDetail(null);
    setEntry('');
    setSelectedCategoryId(null);
    setEditing(null);
  }, [shiftId, stopId]);

  useEffect(() => {
    if (sheet.data) setDetail(sheet.data);
  }, [sheet.data]);

  useEffect(() => {
    if (strip.data) setStops(strip.data);
  }, [strip.data]);

  const reloadAll = useCallback(() => {
    sheet.reload();
    strip.reload();
  }, [sheet, strip]);

  /** The server's answer, applied to both halves of the screen at once: the
   *  sheet, and this stop's mark in the strip (which the same response carries). */
  const applyDetail = (next: ReceiveStopDetail) => {
    setDetail(next);
    setStops((current) => applyStopState(current, next.stopId, next.state));
  };

  const goTo = (target: LeaveTarget) => {
    setEntry('');
    setEditing(null);
    if (target.kind === 'runs') {
      go('receive-runs');
      return;
    }
    if (target.kind === 'receive-done') {
      go('receive-done', { shiftId });
      return;
    }
    if (target.stopId !== stopId) go('receive-stop', { shiftId, stopId: target.stopId });
  };

  /** Every way off this stop goes through here, so the warning cannot be
   *  forgotten on one of them. */
  const leave = (target: LeaveTarget) => {
    if (leaveDecision(entry) === 'warn') {
      setLeaving(target);
      return;
    }
    goTo(target);
  };

  const follow = (target: AdvanceTarget) => {
    if (target.kind === 'stop') leave({ kind: 'stop', stopId: target.stop.id });
    else if (target.kind === 'receive-done') leave({ kind: 'receive-done' });
    // `stay`: nothing else on this run wants a weight and this stop is not
    // resolved either. Going anywhere would strand it, so the button does
    // nothing rather than something wrong.
  };

  const onAdd = async () => {
    if (!detail || selectedCategoryId === null || !canAddWeight(entry)) return;
    setBusy(true);
    try {
      // The typed string, tidied but never reparsed (A165).
      applyDetail(
        await addWeight(shiftId, stopId, {
          categoryId: selectedCategoryId,
          weight: normalizeWeight(entry),
        }),
      );
      // No toast: the number appearing under the tile and the subtotal moving
      // are the confirmation (§3 — a toast is never the only signal, and after
      // twenty crates it would be noise).
      setEntry('');
    } catch (error) {
      toast.error(messageFor(error));
      if (shouldReloadAfter(error)) reloadAll();
    } finally {
      setBusy(false);
    }
  };

  const onSave = async () => {
    if (!editing || !canAddWeight(entry)) return;
    setBusy(true);
    try {
      // One request. The old row is voided and the new one inserted inside a
      // single transaction (I13) — which is invisible here, and stays that way.
      applyDetail(
        await reviseWeight(shiftId, stopId, editing.entryId, { weight: normalizeWeight(entry) }),
      );
      toast.success(COPY.weightSaved);
      setEditing(null);
      setEntry('');
    } catch (error) {
      toast.error(messageFor(error));
      if (shouldReloadAfter(error)) reloadAll();
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async () => {
    if (!editing) return;
    setConfirmingRemove(false);
    setBusy(true);
    try {
      applyDetail(await removeWeight(shiftId, stopId, editing.entryId));
      toast.success(COPY.weightRemoved);
      setEditing(null);
      setEntry('');
    } catch (error) {
      toast.error(messageFor(error));
      if (shouldReloadAfter(error)) reloadAll();
    } finally {
      setBusy(false);
    }
  };

  const onSkip = async () => {
    setConfirmingSkip(false);
    setBusy(true);
    try {
      const next = await skipStop(shiftId, stopId);
      const updated = applyStopState(stops, stopId, next.state);
      setDetail(next);
      setStops(updated);
      toast.success(COPY.stopSkipped);
      // No unsaved-entry warning here: they have just said nothing came from
      // this store, so a number on the keypad is moot.
      setEntry('');
      const target = advanceTargetFor(updated, stopId);
      if (target.kind === 'stop') goTo({ kind: 'stop', stopId: target.stop.id });
      else if (target.kind === 'receive-done') goTo({ kind: 'receive-done' });
    } catch (error) {
      toast.error(messageFor(error));
      if (shouldReloadAfter(error)) reloadAll();
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (entryRow: WeightEntrySummary, categoryName: string) => {
    // Prefilled with the number being replaced, and labelled with it too: the
    // receiver sees what they are overwriting, and correcting one digit is a
    // backspace rather than a retype (§6).
    setEditing({
      entryId: entryRow.id,
      categoryName,
      priorWeight: entryRow.weight,
    });
    setEntry(formatWeight(entryRow.weight));
  };

  const selectCategory = (categoryId: string) => {
    // Picking a category while overwriting a number ends the overwrite: a
    // revision stays on its own tile (A164), so the two cannot be combined.
    setEditing(null);
    setEntry('');
    setSelectedCategoryId(categoryId);
  };

  // --- the states before there is a sheet -----------------------------------

  if (stopId === '') {
    return (
      <div className="r3-sheet r3-sheet--message">
        <EmptyState
          title={COPY.noStopTitle}
          action={
            <Button variant="primary" onClick={() => go('receive-runs')}>
              {COPY.pickRun}
            </Button>
          }
        >
          {COPY.noStopNext}
        </EmptyState>
      </div>
    );
  }

  if (!detail) {
    if (sheet.error) {
      return (
        <div className="r3-sheet r3-sheet--message">
          <ErrorBlock error={sheet.error} onRetry={reloadAll} />
        </div>
      );
    }
    if (sheet.showLoading) {
      return (
        <div className="r3-sheet r3-sheet--message">
          <SkeletonRows rows={5} label={COPY.loadingSheet} />
        </div>
      );
    }
    // Under 300ms, nothing at all (§6).
    return null;
  }

  // --- the sheet ------------------------------------------------------------

  const open = sheetIsOpen(detail);
  const tiles = orderedTiles(detail.tiles);
  const selectedTile = tiles.find((tile) => tile.categoryId === selectedCategoryId) ?? null;
  const runDone = allStopsResolved(stops);

  return (
    <div className="r3-sheet">
      <header className="r3-sheet__head">
        <div className="r3-sheet__title">
          <p className="r3-sheet__label">{COPY.weighingLabel}</p>
          <h1>{detail.donorName}</h1>
        </div>
        {stops.length === 0 && strip.error ? (
          // The sheet loaded and the strip did not. Weighing still works; the
          // way between stops does not, so say so and offer the retry (§6)
          // rather than leaving a silent dead button under the keypad.
          <ErrorBlock error={strip.error} onRetry={strip.reload} />
        ) : (
          <StopStrip
            stops={stops}
            currentStopId={stopId}
            onPick={(id) => leave({ kind: 'stop', stopId: id })}
          />
        )}
      </header>

      {runDone ? (
        <div className="r3-sheet__banner">
          <p>{COPY.allDoneBanner}</p>
          <Button variant="secondary" onClick={() => leave({ kind: 'receive-done' })}>
            {COPY.goToReceiveDone}
          </Button>
        </div>
      ) : null}

      <StopNotes detail={detail} />

      {open ? null : (
        <p className="r3-sheet__closed">
          <strong>{detail.state === 'SKIPPED' ? COPY.skippedTitle : COPY.movedTitle}</strong>{' '}
          {detail.state === 'SKIPPED' ? COPY.skippedNext : COPY.movedNext}
        </p>
      )}

      {tiles.length === 0 ? (
        <EmptyState title={COPY.noCategories}>{COPY.noCategoriesNext}</EmptyState>
      ) : (
        <ul className="r3-tiles">
          {tiles.map((tile) => (
            <CategoryTile
              key={tile.categoryId}
              tile={tile}
              selected={tile.categoryId === selectedCategoryId}
              editingEntryId={editing?.entryId ?? null}
              open={open}
              onSelect={() => selectCategory(tile.categoryId)}
              onEditEntry={(entryRow) => startEdit(entryRow, tile.categoryName)}
            />
          ))}
        </ul>
      )}

      {open ? (
        <KeypadPanel
          detail={detail}
          selectedTile={selectedTile}
          entry={entry}
          onEntryChange={(next) => setEntry((current) => acceptKeypadValue(current, next))}
          editing={editing}
          busy={busy}
          onAdd={() => void onAdd()}
          onSave={() => void onSave()}
          onCancelEdit={() => {
            setEditing(null);
            setEntry('');
          }}
          onRemove={() => setConfirmingRemove(true)}
          onAdvance={() => follow(advanceTargetFor(stops, stopId))}
          onSkip={() => setConfirmingSkip(true)}
        />
      ) : (
        <ClosedPanel
          detail={detail}
          busy={busy}
          onAdvance={() => follow(advanceTargetFor(stops, stopId))}
        />
      )}

      {confirmingSkip ? (
        <ConfirmModal
          question={COPY.skipQuestion}
          consequence={`${detail.donorName}. ${COPY.skipConsequence}`}
          confirmLabel={COPY.skipConfirm}
          busy={busy}
          onCancel={() => setConfirmingSkip(false)}
          onConfirm={() => void onSkip()}
        />
      ) : null}

      {confirmingRemove && editing ? (
        <ConfirmModal
          question={COPY.removeQuestion}
          consequence={`${editing.categoryName}. ${COPY.removeConsequence}`}
          confirmLabel={COPY.removeConfirm}
          busy={busy}
          onCancel={() => setConfirmingRemove(false)}
          onConfirm={() => void onRemove()}
        />
      ) : null}

      {leaving ? (
        <ConfirmModal
          question={COPY.leaveQuestion}
          consequence={COPY.leaveConsequence}
          confirmLabel={COPY.leaveConfirm}
          onCancel={() => setLeaving(null)}
          onConfirm={() => {
            const target = leaving;
            setLeaving(null);
            goTo(target);
          }}
        />
      ) : null}
    </div>
  );
}
