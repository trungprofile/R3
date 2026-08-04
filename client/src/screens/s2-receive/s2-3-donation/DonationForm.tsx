// The S2.3 entry surface — one category, one weight, one source, one Submit.
//
// IT IS S2.2's SHEET (`D76`), not merely "the same shape as" it: the two panes,
// the header and the height arithmetic come from `components/sheet.css`, which the
// two screens now share. They are one job at two grains — a stop of a run, or a
// donation that arrived without one — and the lists that used to sit above this
// form (and made it look like a different kind of screen) are on S2.1b now.
//
// WHICH COLUMN A CONTROL GOES IN. Left is WHAT THIS IS: the store, the kind of
// food, whether it is reported, the note. Right is HOW MUCH: the readout, the
// keypad, the button. That is the same division S2.2 makes, and it is what lets a
// receiver move between the two screens without relearning either. It also puts
// everything that grows with the data — eleven categories, a long donor list — in
// the one column that is allowed to scroll, so the keypad cannot be pushed off.
//
// THE GRAIN IS ONE ROW PER CATEGORY (I18). This form submits one category and one
// weight; a donation spanning three kinds of food is three submissions, exactly as
// adding three weights to a stop is three entries on S2.2. A successful submit
// therefore keeps the store, the note and the report toggle and clears only the
// category and the weight.
//
// ERRORS APPEAR AT TWO DIFFERENT MOMENTS, deliberately:
//   - The donor error is LIVE. It is caused by flipping the report toggle on
//     with nobody named (I16b), so the sentence belongs next to the toggle that
//     caused it, not behind a failed tap.
//   - The category and weight errors appear only after Submit is tapped. Showing
//     "type the weight" on an untouched form scolds someone who has done nothing
//     wrong yet.
//
// Submit is never greyed out. §3 prefers hiding over disabling, and for a form a
// third option is better than either: the button stays live and tapping it says
// what is missing. A grey button with no explanation is the worst of the three
// for a volunteer who is not sure why nothing happened.

import { REPORTABLE_EXPLAINER } from '../../../api/shared.ts';
import type { CategorySummary, DonationSummary, DonorSummary } from '../../../api/shared.ts';
import { Button, NumericKeypad, Segmented, TextInput } from '../../../components/index.ts';
import type { SegmentedOption } from '../../../components/index.ts';
import { COPY, tileCategories, validateDraft } from './donation.ts';
import type { DonationDraft, DraftErrors } from './donation.ts';
import { DonorPicker } from './DonorPicker.tsx';

type ReportChoice = 'on' | 'off';

/** The report toggle, as the §3 control that exists rather than a switch that
 *  does not: both answers visible, each a 44px target, exactly one chosen. */
const REPORT_OPTIONS: readonly SegmentedOption<ReportChoice>[] = [
  { value: 'on', label: COPY.reportOn },
  { value: 'off', label: COPY.reportOff },
];

export interface DonationFormProps {
  draft: DonationDraft;
  onDraft: (next: DonationDraft) => void;
  categories: readonly CategorySummary[];
  donors: readonly DonorSummary[];
  /** The driver's row being weighed, or null for a walk-in started from scratch. */
  editing: DonationSummary | null;
  /** True once Submit has been tapped at least once for this draft. */
  showErrors: boolean;
  busy: boolean;
  onSubmit: () => void;
  /** Throw the driver's suggestion away. Absent on a walk-in — there is nothing
   *  to throw away that the Cancel at the top of the screen does not cover. */
  onDiscard?: (() => void) | undefined;
}

export function DonationForm({
  draft,
  onDraft,
  categories,
  donors,
  editing,
  showErrors,
  busy,
  onSubmit,
  onDiscard,
}: DonationFormProps) {
  const tiles = tileCategories(categories);
  const errors: DraftErrors = validateDraft(draft);

  return (
    <div className="r3-sheet__panes">
      {/* WHAT THIS IS. The one region allowed to scroll — see the file header. */}
      <section className="r3-sheet__categories" aria-label={COPY.aboutLabel}>
        {/* --- what kind of food (the S2.2 tile set, from live data) --- */}
        <div className="s23-field">
          <p className="s23-field__label">{COPY.categoryLabel}</p>
          {tiles.length === 0 ? (
            <p className="s23-hint">
              {COPY.noCategories} {COPY.noCategoriesHint}
            </p>
          ) : (
            <ul className="s23-tiles" aria-label={COPY.categoryLabel}>
              {tiles.map((category) => {
                const selected = category.id === draft.categoryId;
                return (
                  <li key={category.id}>
                    <button
                      type="button"
                      className={selected ? 's23-tile is-selected' : 's23-tile'}
                      aria-pressed={selected}
                      disabled={busy}
                      onClick={() =>
                        onDraft({ ...draft, categoryId: selected ? null : category.id })
                      }
                    >
                      {category.name}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {showErrors && errors.category ? (
            <p className="s23-error" role="alert">
              {errors.category}
            </p>
          ) : null}
        </div>

        {/* The store, only when it is still a question. A driver's row already
            names it and the header states it — offering the picker there would
            invite a receiver to overwrite what the driver saw with what they
            guessed, and `confirmSource` sends null to keep the driver's value. */}
        {editing === null ? (
          <DonorPicker
            draft={draft}
            onDraft={onDraft}
            donors={donors}
            disabled={busy}
            {...(errors.donor ? { error: errors.donor } : {})}
          />
        ) : null}

        {/* --- the report toggle, default ON (I15) --- */}
        <div className="s23-field">
          <p className="s23-field__label">{COPY.reportLabel}</p>
          <Segmented
            label={COPY.reportGroupLabel}
            options={REPORT_OPTIONS}
            value={draft.reportable ? 'on' : 'off'}
            onChange={(choice) => onDraft({ ...draft, reportable: choice === 'on' })}
          />
          {/* Verbatim from `shared/src/donation.ts`, which is verbatim from
              `ui-ux-spec.md:333`. This is the key boundary the screen exists to
              make visible, so it is quoted rather than paraphrased. */}
          <p className="s23-explainer">{REPORTABLE_EXPLAINER}</p>
          {/* The donor error belongs here on a driver's row: the picker that
              would normally carry it is not on the screen, and the thing that
              caused it is the toggle directly above. */}
          {editing !== null && errors.donor ? (
            <p className="s23-error" role="alert">
              {errors.donor}
            </p>
          ) : null}
        </div>

        <TextInput
          label={COPY.noteLabel}
          value={draft.note}
          onChange={(note) => onDraft({ ...draft, note })}
          multiline
          disabled={busy}
        />
      </section>

      {/* HOW MUCH. Fixed: nothing in this column grows with the data, which is what
          keeps the keypad on screen without a scroll (`D61`). */}
      <section className="r3-sheet__work" aria-label={COPY.weightLabel}>
        {/* KEYPAD RIGHT, ACTIONS LEFT — S2.2's `.r3-pad` arrangement (`D61`), for
            the same reason: the pad sits under the hand that is already at the
            outer edge of a docked tablet, and the buttons take the width beside it
            rather than a full-width band under it. The keys never move off §3's
            64px floor; if room runs out the CATEGORY column scrolls further. */}
        <div className="s23-pad">
          <div className="s23-pad__actions">
            {/* --- the weight: big keypad, never the system keyboard (§1.5) --- */}
            <p className="s23-weight">
              <span className="r3-numeric">{draft.weight === '' ? '0' : draft.weight}</span>
              <span className="s23-weight__unit">lb</span>
            </p>
            {showErrors && errors.weight ? (
              <p className="s23-error" role="alert">
                {errors.weight}
              </p>
            ) : null}

            {/* §1.1: the one high-emphasis button on this screen. */}
            <Button variant="primary" block loading={busy} onClick={onSubmit}>
              {editing ? COPY.submitConfirm : COPY.submitNew}
            </Button>

            {onDiscard ? (
              <Button variant="secondary" block disabled={busy} onClick={onDiscard}>
                {COPY.discard}
              </Button>
            ) : null}
          </div>

          <div className="s23-pad__keys">
            <NumericKeypad
              value={draft.weight}
              onChange={(weight) => onDraft({ ...draft, weight })}
              allowDecimal
              ariaLabel={COPY.weightKeypadLabel}
              disabled={busy}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
