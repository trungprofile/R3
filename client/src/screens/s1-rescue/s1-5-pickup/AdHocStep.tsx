// "Flag a stop not on my route" — the driver's half of cap 12 (S1.5, Phase 2).
//
// A step of its own rather than a panel under the stop list, for two reasons that
// are both rules rather than taste:
//
//   1. §1.1 allows exactly ONE high-emphasis button per screen. The run screen
//      already spends its primary on the focused stop, or on "Complete this run"
//      once no stop is pending. A form with a weak submit is worse than a form on
//      its own screen, so this takes the screen.
//   2. The thing being recorded is NOT a stop (I14). Keeping it off the stop list
//      structurally is easier to keep true than remembering not to render it there.
//
// WHAT IS NOT ON THIS SCREEN, and why:
//
//   - A weight. The driver has no scale, so the row is stored with `weight` null
//     and the receiver supplies it at S2.3 (I16a requires a weight only once the
//     row is CONFIRMED).
//   - A category, since D24. It used to be here because `domain-modeling.md §2.3`
//     required one on every UnscheduledDonation; that was amended under explicit
//     human authorization so `category_id` is required on CONFIRMED only, and the
//     receiver now picks it where the food is in front of them. Which incidentally
//     makes `ui-ux-spec.md:193` — "just a donor picker … and an optional note" —
//     true again after D8 had to overrule it.
//   - An anonymous store. `ck_ud_i16b_source` allows an unattributed row only when
//     it is not reportable, and a driver's flag is reportable by default (I15). So
//     "Other" requires a typed name.
//
// The picker is a column of big visible options, never a dropdown (§1.5).

import { useState } from 'react';
import { useAsyncData, useToast } from '../../../app/index.ts';
import { Button, EmptyState, ErrorBlock, SkeletonRows, TextInput } from '../../../components/index.ts';
import type { DonationSummary, RunDetail } from '../../../api/shared.ts';
import { fetchDonors, flagAdHocPickup } from './api.ts';
import {
  AD_HOC_LABEL_CHOICE,
  COPY,
  EMPTY_AD_HOC_DRAFT,
  adHocChoiceOf,
  adHocReady,
  adHocRequest,
  adHocStoreFor,
  adHocStoreProblem,
  isOnRouteRefusal,
  messageFor,
  selectableDonors,
} from './logic.ts';

export interface AdHocStepProps {
  run: RunDetail;
  /** The row the server created. The run screen lists it apart from the stops. */
  onFlagged: (donation: DonationSummary) => void;
  onClose: () => void;
}

/** One big option in a picker. A whole-row target (§3), so a gloved thumb in a
 *  truck has 56px to aim at rather than a radio dot. */
function Choice({
  chosen,
  label,
  hint,
  onPick,
}: {
  chosen: boolean;
  label: string;
  hint?: string | null;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={chosen}
      className={`r3-truck${chosen ? ' r3-truck--chosen' : ''}`}
      onClick={onPick}
    >
      <span className="r3-adhoc__option">
        <span className="r3-truck__name">{label}</span>
        {hint ? <span className="r3-adhoc__option-hint">{hint}</span> : null}
      </span>
      <span className="r3-truck__mark" aria-hidden="true" />
    </button>
  );
}

export function AdHocStep({ run, onFlagged, onClose }: AdHocStepProps) {
  const toast = useToast();
  const donors = useAsyncData(fetchDonors);

  const [draft, setDraft] = useState(EMPTY_AD_HOC_DRAFT);
  // Kept beside the draft so switching away from "Other" and back does not wipe
  // what was typed.
  const [typedLabel, setTypedLabel] = useState('');
  const [busy, setBusy] = useState(false);
  // I29's refusal belongs next to the picker that caused it, not in a toast that
  // slides away while the driver is still looking at the wrong store.
  const [refusal, setRefusal] = useState<string | null>(null);

  const storeList = donors.data ? selectableDonors(donors.data, run.stops) : [];
  const choice = adHocChoiceOf(draft.store);
  const storeProblem = adHocStoreProblem(draft);

  const pickStore = (value: string) => {
    setRefusal(null);
    setDraft((current) => ({ ...current, store: adHocStoreFor(value, typedLabel) }));
  };

  const typeLabel = (value: string) => {
    setTypedLabel(value);
    setDraft((current) => ({ ...current, store: { kind: 'label', donorLabel: value } }));
  };

  const submit = async () => {
    const request = adHocRequest(draft);
    // Communication only: the server validates the same shape again, and a null
    // here just means the submit is still disabled.
    if (request === null) return;

    setBusy(true);
    setRefusal(null);
    try {
      const donation = await flagAdHocPickup(run.shiftId, request);
      onFlagged(donation);
      toast.success(COPY.flagSuccess);
      onClose();
    } catch (error) {
      const message = messageFor(error);
      // I29: this store is already a stop on this run. Plainly, in place.
      if (isOnRouteRefusal(error)) setRefusal(message);
      else toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  const loadError = donors.error;
  const loading = !donors.data && donors.showLoading;

  return (
    <>
      <header className="r3-pickup__head">
        <h1>{COPY.flagTitle}</h1>
        <p className="r3-pickup__meta">{run.routeName}</p>
      </header>

      {loadError ? <ErrorBlock error={loadError} onRetry={donors.reload} /> : null}
      {!loadError && loading ? <SkeletonRows rows={3} /> : null}

      {/* --- Which store? -------------------------------------------------- */}
      <h2>{COPY.flagStoreLabel}</h2>
      <p className="r3-pickup__hint">{COPY.flagStoreHint}</p>

      {donors.data && storeList.length === 0 ? (
        <EmptyState title={COPY.flagNoDonors}>{COPY.flagNoDonorsNext}</EmptyState>
      ) : null}

      <div className="r3-truck-list" role="radiogroup" aria-label={COPY.flagStoreLabel}>
        {storeList.map((donor) => (
          <Choice
            key={donor.id}
            chosen={choice === donor.id}
            label={donor.name}
            hint={donor.address}
            onPick={() => pickStore(donor.id)}
          />
        ))}
        {/* No hint (D21): "Other" beside a list of named stores says what it is,
            and the only thing a driver could not work out — that it needs a name
            typed in — is said by `storeProblem` at the box itself. */}
        <Choice
          chosen={choice === AD_HOC_LABEL_CHOICE}
          label={COPY.flagOtherStore}
          onPick={() => pickStore(AD_HOC_LABEL_CHOICE)}
        />
      </div>

      {choice === AD_HOC_LABEL_CHOICE ? (
        <div className="r3-adhoc__label-field">
          <TextInput
            label={COPY.flagOtherStoreLabel}
            value={typedLabel}
            onChange={typeLabel}
            disabled={busy}
            // A hint rather than an error: nothing has gone wrong yet, and the
            // driver has only just opened the box. It says the one thing the
            // label cannot, which is why the submit below is dead (D21, D24), and
            // it disappears the moment they type.
            {...(storeProblem === null ? {} : { hint: storeProblem })}
          />
        </div>
      ) : null}

      {refusal ? (
        <p className="r3-adhoc__refusal" role="alert">
          {refusal}
        </p>
      ) : null}

      <div className="r3-adhoc__note">
        {/* No hint: "Note for the pantry" over an empty box already says what to
            put in it and that leaving it empty is fine (D21). */}
        <TextInput
          label={COPY.flagNoteLabel}
          value={draft.note}
          onChange={(note) => setDraft((current) => ({ ...current, note }))}
          multiline
          disabled={busy}
        />
      </div>

      <div className="r3-pickup__primary">
        {/* Stays visible while unusable: it is the sentence that says what the
            pickers lead to (§3 disabled-vs-hidden). */}
        <Button
          variant="primary"
          block
          disabled={!adHocReady(draft)}
          loading={busy}
          onClick={() => void submit()}
        >
          {COPY.flagSubmit}
        </Button>
        <Button variant="secondary" block disabled={busy} onClick={onClose}>
          {COPY.backToStops}
        </Button>
      </div>
    </>
  );
}
