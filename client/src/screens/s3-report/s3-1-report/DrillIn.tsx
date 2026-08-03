// S3.1's drill-in — Success Metric 4, "100% of line items resolve to a
// store-category-day".
//
// One AGFP category's entries for the week on screen: the store, the day, who
// logged it (I26), and the weight. That is the whole promise of the metric, and
// the reason a number on this screen is never just a number.
//
// TWO CORRECTIONS LIVE HERE AND THEY ARE NOT THE SAME ACTION (`shared/src/report.ts`):
//
//   - **A weight** is immutable and corrects by void-old + insert-new (I13). To
//     the Reporter it is a plain overwrite: the prior value is shown so they see
//     what they are replacing, and there is no undo and no history UI. The void
//     trail is the server's business and never appears here (§6, PRD).
//   - **A donation's report switch** is a plain field edit, last write wins (cap
//     15). It is a switch, not an overwrite, and only a DONATION carries one —
//     I15 makes scheduled intake reportable by construction, so a WEIGHT has no
//     flag to flip.
//
// Neither is window-gated (D14). After the receiver's edit window closes this
// screen is the ONLY remaining way to correct an entry, which is the point of it.

import { useCallback, useEffect, useState } from 'react';
import { useAsyncData, useToast } from '../../../app/index.ts';
import {
  Button,
  EmptyState,
  ErrorBlock,
  List,
  ListItem,
  NumericKeypad,
  Segmented,
  SkeletonRows,
  TextInput,
} from '../../../components/index.ts';
import type { ReportEntry } from '../../../api/shared.ts';
import { fetchEntries, reviseWeight, setReportable } from './api.ts';
import {
  COPY,
  KEYPAD_MAX_DIGITS,
  acceptKeypadValue,
  canSaveWeight,
  drillTotals,
  entryDescription,
  entrySource,
  formatWeight,
  groupEntriesByDay,
  hasReportToggle,
  messageFor,
  normalizeWeight,
  reportableChoices,
  reportableSavedText,
  weightError,
  weightWithUnit,
  type DateRange,
} from './report.ts';

export interface DrillInProps {
  /** The window being reported (D41). The entries under a category are scoped to
   *  the same two dates the totals above them were computed over. */
  range: DateRange;
  categoryId: string;
  categoryName: string;
  /** What the line above reports for this category — NET of the trash deduction
   *  since D27. Passed down so the panel can show the arithmetic rather than a
   *  subtotal that silently disagrees with the number a few lines up. */
  categoryTotal: string;
  /** Told when a write lands, so the week's totals above re-read. A revised
   *  weight moves `reportedTotal`; a flipped switch moves weight between
   *  `reportedTotal` and `unreportedTotal`, and both must change together. */
  onChanged: () => void;
  onClose: () => void;
}

export function DrillIn({
  range,
  categoryId,
  categoryName,
  categoryTotal,
  onChanged,
  onClose,
}: DrillInProps) {
  const toast = useToast();

  const load = useCallback(
    (signal: AbortSignal) => fetchEntries(range, categoryId, signal),
    [range, categoryId],
  );
  const remote = useAsyncData<ReportEntry[]>(load);

  // A revision comes back as the category's entries as they now stand, so the
  // panel re-renders from the server's answer rather than from a guess about what
  // the write did. Cleared whenever a fresh read lands underneath it.
  const [revised, setRevised] = useState<ReportEntry[] | null>(null);
  useEffect(() => setRevised(null), [remote.data]);

  const [editing, setEditing] = useState<ReportEntry | null>(null);
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const entries = revised ?? remote.data;

  const openEdit = (entry: ReportEntry) => {
    setEditing(entry);
    // Starts empty rather than pre-filled: the prior value is shown beside the
    // keypad, and a pre-filled field invites a half-edited number.
    setDraft('');
    setNote('');
    setAttempted(false);
    setFailure(null);
  };

  const closeEdit = () => {
    setEditing(null);
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
      const list = await reviseWeight(
        entry.id,
        {
          // The digits typed, never reparsed (A165).
          weight: normalizeWeight(draft),
          ...(trimmedNote === '' ? {} : { note: trimmedNote }),
        },
        // The panel comes back scoped to the range on screen and to this category
        // (D41). It used to come back as the whole week across every category, and
        // render under this one's heading.
        range,
      );
      setRevised(list);
      closeEdit();
      toast.success(COPY.editSaved);
      onChanged();
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
      // The switch changes which side of the report this weight sits on, so both
      // the panel and the week above it are re-read rather than patched here.
      remote.reload();
      onChanged();
    } catch (cause) {
      setFailure(messageFor(cause));
    } finally {
      setTogglingId(null);
    }
  };

  return (
    <div className="s31-drill" aria-label={`${COPY.drillLabel}, ${categoryName}`}>
      {remote.error !== null ? <ErrorBlock error={remote.error} onRetry={remote.reload} /> : null}

      {failure !== null ? (
        <p className="s31-error" role="alert">
          {failure}
        </p>
      ) : null}

      {entries === null ? (
        // Nothing at all under 300ms (§6) — `showLoading` carries the delay.
        remote.showLoading ? (
          <SkeletonRows rows={3} label={COPY.drillLoading} />
        ) : null
      ) : entries.length === 0 ? (
        <EmptyState title={COPY.drillEmptyTitle}>{COPY.drillEmptyBody}</EmptyState>
      ) : (
        <>
          {groupEntriesByDay(entries).map((day) => (
            <section className="s31-day" key={day.day}>
              <h4 className="s31-day__heading">{day.label}</h4>
              <List label={day.label}>
                {day.entries.map((entry) => (
                  <ListItem key={entry.id}>
                    <div className="s31-entry" aria-label={entryDescription(entry)}>
                      <div className="s31-entry__facts">
                        <span className="s31-entry__store">{entry.donorName}</span>
                        <span className="s31-entry__meta">
                          {`${COPY.colReceiver}: ${entry.receiverName} · ${entrySource(entry)}`}
                        </span>
                      </div>
                      <span className="r3-numeric s31-entry__weight">
                        {weightWithUnit(entry.weight)}
                      </span>
                      <div className="s31-entry__actions">
                        {/* ✎ — the same overwrite-look the receiver gets at S2.2. */}
                        <Button
                          variant="secondary"
                          onClick={() => openEdit(entry)}
                          disabled={busy || togglingId !== null}
                        >
                          {`✎ ${COPY.edit}`}
                        </Button>
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

                    {editing?.id === entry.id ? (
                      <form
                        className="s31-edit"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void save(entry);
                        }}
                      >
                        <h5 className="s31-edit__title">{COPY.editTitle}</h5>
                        <p className="s31-edit__hint">{COPY.editHint}</p>
                        {/* §6: the entry shows the prior value so the Reporter
                            sees what they are replacing. No history beyond it. */}
                        <p className="s31-edit__prior">
                          {`${COPY.editPrior}: `}
                          <span className="r3-numeric">{weightWithUnit(entry.weight)}</span>
                        </p>

                        <p className="s31-edit__draft r3-numeric" aria-live="polite">
                          {draft === '' ? '—' : `${formatWeight(draft)} ${COPY.unit}`}
                        </p>
                        {/* §1.5: numbers are typed on a big keypad, never a
                            system keyboard — the rule is not device-specific. */}
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
            </section>
          ))}

          {/* The check a Reporter came here to make: what the rows add up to,
              against the line above. Exact (integer cents) or absent — never a
              float, and never a total that is quietly short.

              For a category the pantry deducts trash from (D27), the line above is
              NET and these rows are what was weighed, so the two would differ by
              the deduction with nothing saying why. Those three numbers are shown
              in full instead. The nine categories with no rate keep the single
              subtotal they always had. */}
          <Totals entries={entries} categoryTotal={categoryTotal} />
        </>
      )}

      <Button variant="secondary" onClick={onClose}>
        {COPY.close}
      </Button>
    </div>
  );
}

/**
 * What the entries add up to, and, where the food bank line is net of a trash
 * deduction, the two other numbers that make it add up (D27).
 *
 * The deduction is DERIVED BY SUBTRACTION in `drillTotals`, never recomputed from
 * a rate: the rate lives on the store and is applied per receipt with a rounding
 * order that is load-bearing (`domain-modeling.md §5.4`), so a second
 * implementation here would be free to disagree with the very number it is
 * explaining. Subtraction cannot.
 */
function Totals({
  entries,
  categoryTotal,
}: {
  entries: readonly ReportEntry[];
  categoryTotal: string;
}) {
  const totals = drillTotals(entries, categoryTotal);

  if (totals.deduction !== null) {
    const { gross, deducted, net } = totals.deduction;
    return (
      <div className="s31-drill__totals">
        <p className="s31-drill__line">
          <span>{COPY.drillGrossLabel}</span>
          <span className="r3-numeric">{weightWithUnit(gross)}</span>
        </p>
        <p className="s31-drill__line">
          <span>{COPY.drillDeductLabel}</span>
          {/* The minus is a mark on a number, not prose: it is what makes the
              three lines read as a subtraction rather than as three unrelated
              figures. */}
          <span className="r3-numeric">{`− ${weightWithUnit(deducted)}`}</span>
        </p>
        <p className="s31-drill__total">
          <span>{COPY.drillNetLabel}</span>
          <span className="r3-numeric">{weightWithUnit(net)}</span>
        </p>
        <p className="s31-drill__note">{COPY.drillDeductNote}</p>
      </div>
    );
  }

  if (totals.shown === null) return null;
  return (
    <p className="s31-drill__total">
      <span>{COPY.drillTotalLabel}</span>
      <span className="r3-numeric">{weightWithUnit(totals.shown)}</span>
    </p>
  );
}
