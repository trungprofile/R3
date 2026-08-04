// The two corrections PRD cap 15 gives the REPORT duty, on the receipt the
// reporter is typing into (D54).
//
// WHY THIS FILE EXISTS AND `DrillIn.tsx` DOES NOT. Both controls were built, both
// worked, and neither was ever used: they hung off a per-category drill-in on a
// totals page the reporter read as analysis rather than as their job, two clicks
// down. They reported the weight edit as a missing feature. Nothing about the
// operations changed — this is the same `PUT /report/weights/:id` and the same
// `PATCH /report/donations/:id/reportable`, against the entries behind ONE receipt
// instead of one category.
//
// TWO CORRECTIONS, AND THEY ARE NOT THE SAME ACTION (`shared/src/report.ts`):
//
//   - **A weight** is immutable and corrects by void-old + insert-new (I13). To the
//     reporter it is a plain overwrite: the prior value is shown so they see what
//     they are replacing, and there is no undo and no history UI. The void trail is
//     the server's business and never appears here (§6, PRD).
//   - **A donation's report switch** is a plain field edit, last write wins (cap
//     15). Only a DONATION carries one — I15 makes scheduled intake reportable by
//     construction, so a WEIGHT has no flag to flip.
//
// Neither is window-gated (D14). After the receiver's edit window closes this is
// the ONLY remaining way to correct an entry, which is the point of it.
//
// It does not print. A printout is the portal's form on paper (D29); a control
// that cannot be pressed on paper is noise beside the numbers being typed.

import { useState } from 'react';
import { useToast } from '../../../app/index.ts';
import {
  Button,
  List,
  ListItem,
  NumericKeypad,
  Segmented,
  TextInput,
} from '../../../components/index.ts';
import type { ReportEntry } from '../../../api/shared.ts';
import { reviseWeight, setReportable } from './api.ts';
import {
  COPY,
  KEYPAD_MAX_DIGITS,
  acceptKeypadValue,
  canSaveWeight,
  correctionsTotal,
  entryDescription,
  entrySource,
  formatWeight,
  hasReportToggle,
  hasWeightEdit,
  messageFor,
  normalizeWeight,
  reportableChoices,
  reportableSavedText,
  weightError,
  weightWithUnit,
  type DateRange,
} from './report.ts';

export interface CorrectionsProps {
  /** The window being reported (D41). It rides on the write so the server scopes
   *  its answer to the same dates, and it is what the screen re-reads afterwards. */
  range: DateRange;
  /** The entries behind THIS receipt, already sifted (`entriesForReceipt`). */
  entries: readonly ReportEntry[];
  /** Told when a write lands. The screen re-reads the receipts AND the entries
   *  together: a revised weight moves a line, a receipt total and possibly the
   *  trash deduction (D27), and a flipped switch moves a donation between the two
   *  sections — none of which this component is in a position to guess at. */
  onChanged: () => void | Promise<void>;
}

export function Corrections({ range, entries, onChanged }: CorrectionsProps) {
  const toast = useToast();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const openEdit = (entry: ReportEntry) => {
    setEditingId(entry.id);
    // Starts empty rather than pre-filled: the prior value is shown beside the
    // keypad, and a pre-filled field invites a half-edited number.
    setDraft('');
    setNote('');
    setAttempted(false);
    setFailure(null);
  };

  const closeEdit = () => {
    setEditingId(null);
    setAttempted(false);
    setFailure(null);
  };

  const save = async (entry: ReportEntry) => {
    setAttempted(true);
    if (!canSaveWeight(draft)) return;
    setBusy(true);
    setFailure(null);
    try {
      const trimmedNote = note.trim();
      await reviseWeight(
        entry.id,
        {
          // The digits typed, never reparsed (A165).
          weight: normalizeWeight(draft),
          ...(trimmedNote === '' ? {} : { note: trimmedNote }),
        },
        range,
      );
      closeEdit();
      toast.success(COPY.editSaved);
      await onChanged();
    } catch (cause) {
      setFailure(messageFor(cause));
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (entry: ReportEntry, reportable: boolean) => {
    if (reportable === entry.reportable) return;
    setTogglingId(entry.id);
    setFailure(null);
    try {
      await setReportable(entry.id, reportable);
      toast.success(reportableSavedText(entry.donorName, reportable));
      await onChanged();
    } catch (cause) {
      // I16b lands here: an anonymous walk-in cannot be turned on, and the server's
      // own sentence says why. The rule is enforced in `setReportable` and is not
      // re-implemented on this screen.
      setFailure(messageFor(cause));
    } finally {
      setTogglingId(null);
    }
  };

  const total = correctionsTotal(entries);

  return (
    <section className="s31-corrections" aria-label={COPY.correctionsLabel}>
      {/* D69 cut the paragraph under this heading. The heading names what the block
          is for and every row carries its own Change weight button; the sentence
          restated both. */}
      <h4 className="s31-corrections__title">{COPY.correctionsLabel}</h4>

      {failure !== null ? (
        <p className="s31-error" role="alert">
          {failure}
        </p>
      ) : null}

      {entries.length === 0 ? (
        <p className="s31-corrections__empty">{COPY.correctionsEmpty}</p>
      ) : (
        <>
          <List label={COPY.correctionsLabel}>
            {entries.map((entry) => (
              <ListItem key={entry.id}>
                <div className="s31-entry" aria-label={entryDescription(entry)}>
                  <div className="s31-entry__facts">
                    <span className="s31-entry__store">{entry.categoryName}</span>
                    <span className="s31-entry__meta">
                      {`${COPY.colReceiver}: ${entry.receiverName} · ${entrySource(entry)}`}
                    </span>
                  </div>
                  <span className="r3-numeric s31-entry__weight">
                    {weightWithUnit(entry.weight)}
                  </span>
                  <div className="s31-entry__actions">
                    {/* The same overwrite-look the receiver gets at S2.2 — and
                        only on a WEIGHT. `PUT /report/weights/:id` voids and
                        re-inserts a `weight_entry` (I13); a donation's id is not
                        one, so the drill-in's ✎ on a walk-in could only ever come
                        back "No such entry." A walk-in corrects through the switch
                        beside it, and through S2.3 while the window is open. */}
                    {hasWeightEdit(entry) ? (
                      <Button
                        variant="secondary"
                        onClick={() => openEdit(entry)}
                        disabled={busy || togglingId !== null}
                      >
                        {`✎ ${COPY.edit}`}
                      </Button>
                    ) : null}
                    {hasReportToggle(entry) ? (
                      <Segmented
                        label={COPY.reportToggleLabel}
                        options={reportableChoices()}
                        value={entry.reportable ? 'on' : 'off'}
                        onChange={(next) => void toggle(entry, next === 'on')}
                      />
                    ) : null}
                  </div>
                </div>

                {editingId === entry.id ? (
                  <form
                    className="s31-edit"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void save(entry);
                    }}
                  >
                    <h5 className="s31-edit__title">{COPY.editTitle}</h5>
                    <p className="s31-edit__hint">{COPY.editHint}</p>
                    {/* §6: the entry shows the prior value so the Reporter sees
                        what they are replacing. No history beyond it. */}
                    <p className="s31-edit__prior">
                      {`${COPY.editPrior}: `}
                      <span className="r3-numeric">{weightWithUnit(entry.weight)}</span>
                    </p>

                    <p className="s31-edit__draft r3-numeric" aria-live="polite">
                      {draft === '' ? '—' : `${formatWeight(draft)} ${COPY.unit}`}
                    </p>
                    {/* §1.5: numbers are typed on a big keypad, never a system
                        keyboard — the rule is not device-specific. */}
                    <NumericKeypad
                      value={draft}
                      onChange={(next) => setDraft(acceptKeypadValue(draft, next))}
                      allowDecimal
                      maxLength={KEYPAD_MAX_DIGITS}
                      ariaLabel={COPY.editKeypadLabel}
                      disabled={busy}
                    />

                    <TextInput
                      label={COPY.editNoteLabel}
                      hint={COPY.editNoteHint}
                      value={note}
                      onChange={setNote}
                      disabled={busy}
                      autoComplete="off"
                    />

                    {weightError(draft, attempted) !== null ? (
                      <p className="s31-error" role="alert">
                        {weightError(draft, attempted)}
                      </p>
                    ) : null}

                    <div className="s31-edit__actions">
                      <Button variant="primary" type="submit" loading={busy}>
                        {COPY.editSave}
                      </Button>
                      <Button variant="secondary" onClick={closeEdit} disabled={busy}>
                        {COPY.editCancel}
                      </Button>
                    </div>
                  </form>
                ) : null}
              </ListItem>
            ))}
          </List>

          {/* What the weights add up to, against the card above them. Exact
              (integer cents) or absent — never a float, and never a total that is
              quietly short. Reportable entries only: a donation with the switch
              off is listed and marked but never reached a line above, so counting
              it here would make the two disagree by the very thing being shown.

              It can still differ from Total Pounds by a pound or two, because the
              card's lines are rounded whole (D28) and the Trash line is deducted
              from them (D27). `wholePoundsNote` is where that is explained, and
              since D69 it is on the printed receipt rather than on screen. */}
          {total === null ? null : (
            <p className="s31-corrections__total">
              <span>{COPY.correctionsTotalLabel}</span>
              <span className="r3-numeric">{weightWithUnit(total)}</span>
            </p>
          )}
        </>
      )}
    </section>
  );
}
