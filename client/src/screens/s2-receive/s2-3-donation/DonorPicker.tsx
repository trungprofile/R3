// "Where did it come from?" — the donor field of S2.3.
//
// Three ways to answer, and the screen shows all three at once rather than
// hiding two behind a dropdown (§1.5): pick a store from the master list, type a
// name, or name nobody. The mode is a §3 segmented control, which is the
// house stand-in for the dropdown this population should not be given.
//
// The mode is the ONLY input the two source columns are derived from
// (`donation.ts` `createSource` / `confirmSource`), so "a donor id and a label at
// the same time" — which `ck_ud_source_exclusive` refuses at the storage layer —
// is not a state this screen can reach.
//
// "No name" stays offered even while the report toggle is ON. It is refused, not
// hidden: I16b is about what may be STORED, and a receiver who taps it while
// reporting needs to be told why it will not do (the message appears under the
// picker) rather than left wondering where the option went.

import { Segmented, TextInput } from '../../../components/index.ts';
import type { SegmentedOption } from '../../../components/index.ts';
import type { DonationSource, DonorSummary } from '../../../api/shared.ts';
import { COPY, pickableDonors } from './donation.ts';
import type { DonationDraft } from './donation.ts';

const MODES: readonly SegmentedOption<DonationSource>[] = [
  { value: 'MASTER', label: COPY.sourceMaster },
  { value: 'LABEL', label: COPY.sourceLabelMode },
  { value: 'ANON', label: COPY.sourceAnon },
];

export interface DonorPickerProps {
  draft: DonationDraft;
  onDraft: (next: DonationDraft) => void;
  donors: readonly DonorSummary[];
  /** I16b, when it applies. Rendered under the whole field, not under one mode. */
  error?: string | undefined;
  disabled?: boolean;
}

export function DonorPicker({ draft, onDraft, donors, error, disabled = false }: DonorPickerProps) {
  const options = pickableDonors(donors, draft.donorId);

  return (
    <div className="s23-field">
      <p className="s23-field__label">{COPY.sourceLabel}</p>

      <Segmented
        label={COPY.sourceGroupLabel}
        options={MODES}
        value={draft.sourceMode}
        onChange={(sourceMode) => onDraft({ ...draft, sourceMode })}
      />

      {draft.sourceMode === 'MASTER' ? (
        options.length === 0 ? (
          <p className="s23-hint">
            {COPY.noDonors} {COPY.noDonorsHint}
          </p>
        ) : (
          // A visible list of big targets, not a dropdown (§1.5). Scrolls in place
          // so the keypad below never moves off screen as the list grows.
          <ul className="s23-donors" aria-label={COPY.donorListLabel}>
            {options.map((donor) => {
              const selected = donor.id === draft.donorId;
              return (
                <li key={donor.id}>
                  <button
                    type="button"
                    className={selected ? 's23-donor is-selected' : 's23-donor'}
                    aria-pressed={selected}
                    disabled={disabled}
                    onClick={() => onDraft({ ...draft, donorId: selected ? null : donor.id })}
                  >
                    <span className="s23-donor__name">{donor.name}</span>
                    {donor.active ? null : (
                      <span className="s23-donor__note">{COPY.archivedDonor}</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )
      ) : null}

      {draft.sourceMode === 'LABEL' ? (
        <TextInput
          label={COPY.donorTypedLabel}
          hint={COPY.donorTypedHint}
          value={draft.donorLabel}
          onChange={(donorLabel) => onDraft({ ...draft, donorLabel })}
          disabled={disabled}
        />
      ) : null}

      {draft.sourceMode === 'ANON' ? <p className="s23-hint">{COPY.donorAnonHint}</p> : null}

      {error ? (
        <p className="s23-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
