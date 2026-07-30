// "Flag a stop not on my route" — the driver's half of cap 12 (S1.5, Phase 2).
//
// A step of its own rather than a panel under the stop list, for two reasons that
// are both rules rather than taste:
//
//   1. §1.1 allows exactly ONE high-emphasis button per screen. The run screen
//      already spends its primary on the focused stop, or on "Heading back" once
//      no stop is pending. A form with a weak submit is worse than a form on its
//      own screen, so this takes the screen the way `ReviewStep` does.
//   2. The thing being recorded is NOT a stop (I14). Keeping it off the stop list
//      structurally is easier to keep true than remembering not to render it there.
//
// WHAT IS NOT ON THIS SCREEN: a weight. The driver has no scale, so the row is
// stored with `weight` null and the receiver supplies it at S2.3 (I16a requires a
// weight only once the row is CONFIRMED).
//
// WHAT IS, despite S1.5's prose: a category. `ui-ux-spec.md:193` calls this "just a
// donor picker … and an optional note", but `domain-modeling.md §2.3` (locked)
// makes Category required on UnscheduledDonation with no SUGGESTED exemption, and
// `data-model.md §7.2` stores `category_id NOT NULL`. The locked doc wins
// (`CLAUDE.md` authority order); build-plan D8 records it and the escalation.
//
// Both pickers are columns of big visible options, never dropdowns (§1.5).

import { useState } from 'react';
import { useAsyncData, useToast } from '../../../app/index.ts';
import { Button, EmptyState, ErrorBlock, SkeletonRows, TextInput } from '../../../components/index.ts';
import type { DonationSummary, RunDetail } from '../../../api/shared.ts';
import { fetchCategories, fetchDonors, flagAdHocPickup } from './api.ts';
import {
  AD_HOC_ANON_CHOICE,
  AD_HOC_LABEL_CHOICE,
  COPY,
  EMPTY_AD_HOC_DRAFT,
  adHocChoiceOf,
  adHocReady,
  adHocRequest,
  adHocStoreFor,
  isOnRouteRefusal,
  messageFor,
  selectableCategories,
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
  const categories = useAsyncData(fetchCategories);

  const [draft, setDraft] = useState(EMPTY_AD_HOC_DRAFT);
  // Kept beside the draft so switching away from "Somewhere else" and back does
  // not wipe what was typed.
  const [typedLabel, setTypedLabel] = useState('');
  const [busy, setBusy] = useState(false);
  // I29's refusal belongs next to the picker that caused it, not in a toast that
  // slides away while the driver is still looking at the wrong store.
  const [refusal, setRefusal] = useState<string | null>(null);

  const storeList = donors.data ? selectableDonors(donors.data, run.stops) : [];
  const categoryList = categories.data ? selectableCategories(categories.data) : [];
  const choice = adHocChoiceOf(draft.store);

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

  const loadError = donors.error ?? categories.error;
  const loading = !donors.data && !categories.data && (donors.showLoading || categories.showLoading);

  return (
    <>
      <header className="r3-pickup__head">
        <h1>{COPY.flagTitle}</h1>
        <p className="r3-pickup__meta">{run.routeName}</p>
      </header>

      <p className="r3-pickup__hint">{COPY.flagIntro}</p>

      {loadError ? (
        <ErrorBlock
          error={loadError}
          onRetry={() => {
            donors.reload();
            categories.reload();
          }}
        />
      ) : null}
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
        <Choice
          chosen={choice === AD_HOC_LABEL_CHOICE}
          label={COPY.flagOtherStore}
          hint={COPY.flagOtherStoreHint}
          onPick={() => pickStore(AD_HOC_LABEL_CHOICE)}
        />
        <Choice
          chosen={choice === AD_HOC_ANON_CHOICE}
          label={COPY.flagNoStore}
          onPick={() => pickStore(AD_HOC_ANON_CHOICE)}
        />
      </div>

      {choice === AD_HOC_LABEL_CHOICE ? (
        <div className="r3-adhoc__label-field">
          <TextInput
            label={COPY.flagOtherStoreLabel}
            value={typedLabel}
            onChange={typeLabel}
            disabled={busy}
          />
        </div>
      ) : null}

      {refusal ? (
        <p className="r3-adhoc__refusal" role="alert">
          {refusal}
        </p>
      ) : null}

      {/* --- What kind of food? (D8) --------------------------------------- */}
      <h2>{COPY.flagCategoryLabel}</h2>
      <p className="r3-pickup__hint">{COPY.flagCategoryHint}</p>

      {categories.data && categoryList.length === 0 ? (
        <EmptyState title={COPY.flagNoCategories}>{COPY.flagNoCategoriesNext}</EmptyState>
      ) : null}

      {categoryList.length > 0 ? (
        <div className="r3-truck-list" role="radiogroup" aria-label={COPY.flagCategoryLabel}>
          {categoryList.map((category) => (
            <Choice
              key={category.id}
              chosen={draft.categoryId === category.id}
              label={category.name}
              onPick={() => setDraft((current) => ({ ...current, categoryId: category.id }))}
            />
          ))}
        </div>
      ) : null}

      <div className="r3-adhoc__note">
        <TextInput
          label={COPY.flagNoteLabel}
          hint={COPY.flagNoteHint}
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
