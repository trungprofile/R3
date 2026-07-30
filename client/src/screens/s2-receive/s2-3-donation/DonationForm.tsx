// The S2.3 entry surface — one category, one weight, one source, one Submit.
//
// SAME SHAPE AS S2.2's SHEET, and the same grain: a tile per category, the big
// keypad for the number, and one row stored per category (I18). A donation
// spanning three kinds of food is three passes through this form — which is why
// a successful submit keeps the store and the report toggle and clears only the
// category and the weight (`nextInSameDonation`).
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
  /** The prefill being confirmed, or null for a donation started from scratch. */
  editing: DonationSummary | null;
  /** True once Submit has been tapped at least once for this draft. */
  showErrors: boolean;
  busy: boolean;
  onSubmit: () => void;
  onStartOver: () => void;
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
  onStartOver,
}: DonationFormProps) {
  const tiles = tileCategories(categories);
  const errors: DraftErrors = validateDraft(draft);

  return (
    <section className="s23-form" aria-label={editing ? COPY.editHeading : COPY.newHeading}>
      <header className="s23-form__head">
        <h2 className="s23-heading">{editing ? COPY.editHeading : COPY.newHeading}</h2>
        {editing ? (
          <>
            <p className="s23-hint">{COPY.editHint}</p>
            <Button variant="secondary" onClick={onStartOver} disabled={busy}>
              {COPY.startOver}
            </Button>
          </>
        ) : null}
      </header>

      <div className="s23-columns">
        <div className="s23-column">
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

          <DonorPicker
            draft={draft}
            onDraft={onDraft}
            donors={donors}
            disabled={busy}
            {...(errors.donor ? { error: errors.donor } : {})}
          />

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
          </div>
        </div>

        <div className="s23-column s23-column--entry">
          {/* --- the weight: big keypad, never the system keyboard (§1.5) --- */}
          <div className="s23-field">
            <p className="s23-field__label">{COPY.weightLabel}</p>
            <p className="s23-weight">
              <span className="r3-numeric">{draft.weight === '' ? '0' : draft.weight}</span>
              <span className="s23-weight__unit">lb</span>
            </p>
            <NumericKeypad
              value={draft.weight}
              onChange={(weight) => onDraft({ ...draft, weight })}
              allowDecimal
              ariaLabel={COPY.weightKeypadLabel}
              disabled={busy}
            />
            {showErrors && errors.weight ? (
              <p className="s23-error" role="alert">
                {errors.weight}
              </p>
            ) : null}
          </div>

          <TextInput
            label={COPY.noteLabel}
            hint={COPY.noteHint}
            value={draft.note}
            onChange={(note) => onDraft({ ...draft, note })}
            multiline
            disabled={busy}
          />

          {/* §1.1: the one high-emphasis button on this screen. */}
          <Button variant="primary" block loading={busy} onClick={onSubmit}>
            {editing ? COPY.submitConfirm : COPY.submitNew}
          </Button>
          <p className="s23-hint">{COPY.addAnother}</p>
        </div>
      </div>
    </section>
  );
}
