// S2.3 Unscheduled donation — food that arrived outside a scheduled pickup
// (PRD cap 12).
//
// `ui-ux-spec.md S2.3`, on the shared tablet in landscape, one button from S2.1b
// or S2.2. The responsive matrix marks this surface `n/a` on a phone, so there is
// no phone layout — a wide two-column entry area that a desktop browser also
// reads comfortably, and nothing else.
//
// TWO ENTRY PATHS, ONE SCREEN:
//
//   FROM A PREFILL  a driver flagged it mid-run (S1.5) and it arrived as a
//                   `SUGGESTED` row with donor, category and note already filled
//                   (I17). The receiver supplies the weight and confirms. Those
//                   rows are listed FIRST — they are the reason someone is here.
//   FROM SCRATCH    a walk-in or a relayed store call, born `CONFIRMED`.
//
// THE GRAIN IS ONE ROW PER CATEGORY (I18). This form submits one category and one
// weight; a donation spanning three kinds of food is three submissions, exactly
// as adding three weights to a stop is three entries on S2.2. A successful submit
// therefore keeps the store, the note and the report toggle and clears only the
// category and the weight.
//
// WHAT THIS SCREEN NEVER SENDS: a `shiftId`. A receiver-authored donation is a
// walk-in by construction (build-plan D10) — `POST /donations` sets no shift, and
// a walk-in handed over while someone happens to be weighing a run did not come
// from that run. The driver's half of cap 12 is the one that carries a shift, and
// it is sent from S1.5.

import { useCallback, useEffect, useState } from 'react';
import { useAsyncData, useRouter, useToast } from '../../../app/index.ts';
import type { ScreenProps } from '../../../app/index.ts';
import {
  Button,
  ConfirmModal,
  ErrorBlock,
  SkeletonRows,
} from '../../../components/index.ts';
import type { DonationSummary } from '../../../api/shared.ts';
import {
  confirmDonation,
  createDonation,
  discardSuggestion,
  fetchDonationScreen,
  setReportable,
} from './api.ts';
import type { DonationScreenData } from './api.ts';
import {
  COPY,
  confirmBody,
  createBody,
  draftFrom,
  emptyDraft,
  isSubmittable,
  messageFor,
  nextInSameDonation,
  removeRow,
  shouldReloadAfter,
  splitWorklist,
  upsertRow,
} from './donation.ts';
import type { DonationDraft } from './donation.ts';
import { DonationForm } from './DonationForm.tsx';
import { PrefillList } from './PrefillList.tsx';
import { RecordedList } from './RecordedList.tsx';
import './donation.css';

export function DonationScreen({ params }: ScreenProps) {
  // Present only if the registry ever routes a run-scoped variant of this screen;
  // `/donations/new` carries no shift and the fall-through is the pantry-wide
  // worklist. Either way nothing about the SUBMISSION changes — D10 keeps the
  // shift off a receiver-authored row regardless of which door was used.
  const shiftId = params['shiftId'] ?? null;
  const { go } = useRouter();
  const toast = useToast();

  const load = useCallback(
    (signal: AbortSignal) => fetchDonationScreen(shiftId, signal),
    [shiftId],
  );
  const remote = useAsyncData<DonationScreenData>(load);

  // The rows are edited in place by every action here, so they are state rather
  // than read straight off the fetch: each write returns the updated row and
  // replaces it, with no second round trip.
  const [rows, setRows] = useState<DonationSummary[]>([]);
  useEffect(() => {
    if (remote.data) setRows(remote.data.rows);
  }, [remote.data]);

  const [draft, setDraft] = useState<DonationDraft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [discarding, setDiscarding] = useState<DonationSummary | null>(null);

  const editDraft = (next: DonationDraft) => {
    setDraft(next);
    // Once they start fixing what was missing, stop pointing at it.
    if (showErrors && isSubmittable(next)) setShowErrors(false);
  };

  const startOver = () => {
    setEditingId(null);
    setDraft(emptyDraft());
    setShowErrors(false);
  };

  const pickPrefill = (row: DonationSummary) => {
    setEditingId(row.id);
    setDraft(draftFrom(row));
    setShowErrors(false);
  };

  const failed = (error: unknown) => {
    toast.error(messageFor(error));
    // Another receiver confirmed the same prefill, or receive-done swept it
    // (I17). Ordinary on a shared tablet, and fixed by a re-read rather than by
    // asking the receiver to do anything.
    if (shouldReloadAfter(error)) {
      startOver();
      remote.reload();
    }
  };

  const submit = async () => {
    if (!isSubmittable(draft)) {
      // Tapping is how the form tells them what is missing (§6: what happened +
      // what to do). The server refuses the same things again.
      setShowErrors(true);
      return;
    }
    setBusy(true);
    try {
      const saved =
        editingId === null
          ? await createDonation(createBody(draft))
          : await confirmDonation(editingId, confirmBody(draft));
      setRows((current) => upsertRow(current, saved));
      toast.success(editingId === null ? COPY.savedNew : COPY.savedConfirm);
      setEditingId(null);
      // Keep the store and the report choice: the next category of the same
      // donation is one weight away (I18).
      setDraft((current) => nextInSameDonation(current));
      setShowErrors(false);
    } catch (error) {
      failed(error);
    } finally {
      setBusy(false);
    }
  };

  const discard = async (row: DonationSummary) => {
    setBusy(true);
    try {
      await discardSuggestion(row.id);
      setRows((current) => removeRow(current, row.id));
      if (editingId === row.id) startOver();
      toast.success(COPY.discarded);
    } catch (error) {
      failed(error);
    } finally {
      setDiscarding(null);
      setBusy(false);
    }
  };

  const toggleReport = async (row: DonationSummary) => {
    setBusy(true);
    try {
      const saved = await setReportable(row.id, !row.reportable);
      setRows((current) => upsertRow(current, saved));
      toast.success(COPY.reportableSaved);
    } catch (error) {
      failed(error);
    } finally {
      setBusy(false);
    }
  };

  if (remote.error) {
    return (
      <div className="s23">
        <ErrorBlock error={remote.error} onRetry={remote.reload} />
      </div>
    );
  }
  if (remote.data === null) {
    // Nothing at all under 300ms (§6) — `showLoading` already carries the delay.
    return remote.showLoading ? (
      <div className="s23">
        <SkeletonRows rows={5} label={COPY.loading} />
      </div>
    ) : null;
  }

  const { pending, recorded } = splitWorklist(rows);
  const editing = editingId === null ? null : (rows.find((row) => row.id === editingId) ?? null);

  return (
    <div className="s23">
      <header className="s23-head">
        <h1 className="s23-title">{COPY.title}</h1>
        <p className="s23-lede">{COPY.lede}</p>
      </header>

      <PrefillList
        rows={pending}
        activeId={editingId}
        onPick={pickPrefill}
        onDiscard={setDiscarding}
        busy={busy}
      />

      <DonationForm
        draft={draft}
        onDraft={editDraft}
        categories={remote.data.categories}
        donors={remote.data.donors}
        editing={editing}
        showErrors={showErrors}
        busy={busy}
        onSubmit={() => void submit()}
        onStartOver={startOver}
      />

      <RecordedList rows={recorded} onToggleReport={(row) => void toggleReport(row)} busy={busy} />

      <div className="s23-foot">
        <Button variant="secondary" onClick={() => go('receive-runs')}>
          {COPY.backToRuns}
        </Button>
      </div>

      {discarding ? (
        // §6: names the consequence, Cancel takes focus as the calm default, and
        // the confirm button is red. Throwing away a prefill destroys the only
        // record that a driver saw this food.
        <ConfirmModal
          question={COPY.discardQuestion}
          consequence={COPY.discardConsequence}
          confirmLabel={COPY.discardConfirm}
          destructive
          busy={busy}
          onConfirm={() => void discard(discarding)}
          onCancel={() => setDiscarding(null)}
        />
      ) : null}
    </div>
  );
}
