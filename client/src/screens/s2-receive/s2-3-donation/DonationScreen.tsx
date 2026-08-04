// S2.3 Unscheduled donation — food that arrived outside a scheduled pickup
// (PRD cap 12).
//
// `ui-ux-spec.md S2.3`, on the shared tablet in landscape, one tap from S2.1b. The
// responsive matrix marks this surface `n/a` on a phone, so there is no phone
// layout — a wide two-column entry area that a desktop browser also reads
// comfortably, and nothing else.
//
// THIS SCREEN WEIGHS ONE DONATION (`D76`). It used to be three things stacked: a
// list of what drivers had flagged, a form, and a list of what had been recorded.
// Both lists are on S2.1b now, where the rest of a receiver's arrivals are listed,
// and what is left here is the sheet — the same layout S2.2 weighs a stop on.
//
// TWO DOORS, ONE SCREEN:
//
//   /donations/:id/weigh   a driver flagged it mid-run (S1.5) and it arrived as a
//                          `SUGGESTED` row carrying the store and their note
//                          (I17). The receiver supplies the weight and confirms.
//                          The store is settled and the picker is not offered.
//   /donations/new         a walk-in or a relayed store call, born `CONFIRMED`.
//                          The store is still a question, so it is asked.
//
// THE GRAIN IS ONE ROW PER CATEGORY (I18) — see `DonationForm.tsx` for what that
// means for the form, and which column each control lives in and why.
//
// WHAT THIS SCREEN NEVER SENDS: a `shiftId`. A receiver-authored donation is a
// walk-in by construction (build-plan D10) — `POST /donations` sets no shift, and
// a walk-in handed over while someone happens to be weighing a run did not come
// from that run. The driver's half of cap 12 is the one that carries a shift, and
// it is sent from S1.5.

import { useCallback, useState } from 'react';
import { useAsyncData, useRouter, useToast } from '../../../app/index.ts';
import type { ScreenProps } from '../../../app/index.ts';
import { BackLink, ConfirmModal, ErrorBlock, SkeletonRows } from '../../../components/index.ts';
import {
  confirmDonation,
  createDonation,
  discardSuggestion,
  fetchDonationScreen,
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
  shouldReloadAfter,
} from './donation.ts';
import type { DonationDraft } from './donation.ts';
import { DonationForm } from './DonationForm.tsx';
import '../../../components/sheet.css';
import './donation.css';

export function DonationScreen({ params }: ScreenProps) {
  // Present on `/donations/:id/weigh` and absent on `/donations/new` — which door
  // was used is the only difference between the two, and it is read here once.
  const donationId = params['id'] ?? null;
  const { go } = useRouter();
  const toast = useToast();

  const load = useCallback(
    (signal: AbortSignal) => fetchDonationScreen(donationId, signal),
    [donationId],
  );
  const remote = useAsyncData<DonationScreenData>(load);

  const [draft, setDraft] = useState<DonationDraft | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [discarding, setDiscarding] = useState(false);

  // The row is the server's; the draft is seeded from it once and then owned here.
  // `draftFrom` deliberately does NOT carry the category over (D24) — a driver
  // flags a store, not a kind of food, and a prefilled category is a number
  // somebody would confirm without reading.
  const row = remote.data?.donation ?? null;
  const current = draft ?? (row ? draftFrom(row) : emptyDraft());

  const editDraft = (next: DonationDraft) => {
    setDraft(next);
    // Once they start fixing what was missing, stop pointing at it.
    if (showErrors && isSubmittable(next)) setShowErrors(false);
  };

  const leave = () => go('receive-runs');

  const failed = (error: unknown) => {
    toast.error(messageFor(error));
    // Another receiver confirmed the same row, or receive-done swept it (I17).
    // Ordinary on a shared tablet. There is nothing left on this screen to work,
    // so the way out is the list rather than a reload of a row that is gone.
    if (shouldReloadAfter(error)) leave();
  };

  const submit = async () => {
    if (!isSubmittable(current)) {
      // Tapping is how the form tells them what is missing (§6: what happened +
      // what to do). The server refuses the same things again.
      setShowErrors(true);
      return;
    }
    setBusy(true);
    try {
      if (donationId === null) {
        await createDonation(createBody(current));
        toast.success(COPY.savedNew);
        // Keep the store and the report choice: the next category of the same
        // walk-in is one weight away (I18). Staying put is the whole reason this
        // screen does not bounce back to the list on every submit.
        setDraft(nextInSameDonation(current));
        setShowErrors(false);
      } else {
        await confirmDonation(donationId, confirmBody(current));
        toast.success(COPY.savedConfirm);
        // A driver's row is ONE row. There is no second category to add to it —
        // anything else that came with the same delivery is its own walk-in — so
        // the work here is finished and the list is where the next thing is.
        leave();
      }
    } catch (error) {
      failed(error);
    } finally {
      setBusy(false);
    }
  };

  const discard = async () => {
    if (donationId === null) return;
    setBusy(true);
    try {
      await discardSuggestion(donationId);
      toast.success(COPY.discarded);
      leave();
    } catch (error) {
      failed(error);
    } finally {
      setDiscarding(false);
      setBusy(false);
    }
  };

  const backLink = <BackLink label={COPY.back} onBack={leave} />;

  if (remote.error) {
    return (
      <div className="r3-sheet r3-sheet--message">
        {backLink}
        <ErrorBlock error={remote.error} onRetry={remote.reload} />
      </div>
    );
  }
  if (remote.data === null) {
    // Nothing at all under 300ms (§6) — `showLoading` already carries the delay.
    return remote.showLoading ? (
      <div className="r3-sheet r3-sheet--message">
        {backLink}
        <SkeletonRows rows={5} label={COPY.loading} />
      </div>
    ) : null;
  }

  return (
    <div className="r3-sheet">
      {/* §3's one way out of a screen, at the top where a person looks for it
          (D43) — and the ONLY way out, since `D76` made this route `fullScreen`
          and took the bottom nav off it for the same reason S2.2 has none. */}
      {backLink}

      <header className="r3-sheet__head">
        <p className="r3-sheet__label">{row ? COPY.weighingLabel : COPY.newLabel}</p>
        <h1>{row ? row.donorDisplay : COPY.newTitle}</h1>
        {/* The driver, and what they said about it. The reason this row exists is
            that a person saw the food; `D68` settled that a note reads as that
            person speaking rather than as a field. */}
        {row?.note ? (
          <p className="s23-driver-note">
            {row.createdByName ? COPY.noteFrom(row.createdByName) : COPY.noteFromDriver}{' '}
            {row.note}
          </p>
        ) : null}
      </header>

      <DonationForm
        draft={current}
        onDraft={editDraft}
        categories={remote.data.categories}
        donors={remote.data.donors}
        editing={row}
        showErrors={showErrors}
        busy={busy}
        onSubmit={() => void submit()}
        onDiscard={row ? () => setDiscarding(true) : undefined}
      />

      {discarding ? (
        // §6: names the consequence, Cancel takes focus as the calm default, and
        // the confirm button is red. Throwing this away destroys the only record
        // that a driver saw this food.
        <ConfirmModal
          question={COPY.discardQuestion}
          consequence={COPY.discardConsequence}
          confirmLabel={COPY.discardConfirm}
          destructive
          busy={busy}
          onConfirm={() => void discard()}
          onCancel={() => setDiscarding(false)}
        />
      ) : null}
    </div>
  );
}
