// The range's Meal Connect receipts — one card per `(pickup date, donor)` (D29),
// worked through ONE AT A TIME (D34/D35).
//
// WHY A CARD AND NOT A TABLE. D13 built a rectangular worksheet on the assumption
// that the far end took a file. It does not: a submitted receipt and screenshots
// of all three entry screens settled that Meal Connect is a FORM a person types
// into, one receipt at a time. So the export mimics the form — Pickup Date, Donor,
// two checkboxes, the line items, then Number of Items and Total Pounds — and a
// Reporter reads one card top to bottom while filling one portal screen.
//
// WHY A LIST IN FRONT OF THE CARDS (D35). Fifteen full cards down one page is a
// page to lose your place in, and the portal only ever wants one of them. So this
// opens on a COMPACT LIST — a row per receipt with its total and whether it is
// already filed — and a row opens its card. The check-off is what makes the list
// worth having: the portal takes one submission at a time and has no import, so
// "which of these have I done" is the question a reporter asks every time they sit
// back down, and a second reporter asks about the same range. It is stored
// (migration 0018), not held here.
//
// EACH CARD HAS A LINE ACROSS IT, and the halves are different kinds of thing:
//
//   ABOVE  the portal's own fields, in the portal's own words. Typed in.
//   BELOW  ours. The AGFP category behind each line, and every note. NOT typed in,
//          and said so — the reading aid exists because two identical
//          `Prepared Meal / Frozen` rows are indistinguishable now that the
//          Description column is gone, and because "the store wasn't open at the
//          scheduled time" has to reach the food bank somehow.
//
// NOTHING IS BUILT HERE. The receipts come from `GET /report/export`, which is the
// same service call and the same refusal the whole export rests on (A186, D12).
// Re-deriving a total in the browser would be a second path to the same submission
// — one that cannot refuse, and whose short output is invisible at the far end.
//
// PRINTING is `window.print()` and a stylesheet, with no library (D5). It lives
// here rather than on the screen behind (D34): this is where the cards are, and a
// print button with nothing behind it hands the browser a blank page. `report.css`
// promotes this section to the whole page, but ONLY while `PRINT_BODY_CLASS` is on
// the body — see `ReportScreen`.

import { useState } from 'react';
import { useToast } from '../../../app/index.ts';
import {
  BackLink,
  Button,
  ConfirmModal,
  List,
  ListItem,
  ListRow,
  PrinterIcon,
} from '../../../components/index.ts';
import type { Receipt, ReportExport } from '../../../api/shared.ts';
import { clearSubmitted, markSubmitted } from './api.ts';
import {
  COPY,
  TICKED,
  UNTICKED,
  canMarkSubmitted,
  checkboxDescription,
  formatReceiptDate,
  formatDateRange,
  formatWeight,
  isEmptyExport,
  markSubmittedQuestion,
  messageFor,
  noteAuthorLabel,
  receiptDonorLabel,
  receiptEmptyText,
  receiptKey,
  receiptLineLabel,
  receiptLineSource,
  receiptRowDescription,
  receiptRowTitle,
  submittedLabel,
  submittedProgress,
  weightWithUnit,
} from './report.ts';

export interface ReceiptsProps {
  sheet: ReportExport;
  /** The pantry's zone, for rendering when a receipt was filed. A submission is an
   *  instant and the pantry's day is what a reporter means by "yesterday" (A120). */
  timezone?: string | undefined;
  onBack: () => void;
  /** Told after a tick or an un-tick, so the range is re-read from the server
   *  rather than patched here — the fact belongs to everyone looking at it. */
  onChanged: () => void | Promise<void>;
}

export function Receipts({ sheet, timezone, onBack, onChanged }: ReceiptsProps) {
  const toast = useToast();
  /** At most one card is open. The portal takes one submission at a time, so this
   *  is the shape of the work rather than a space-saving decision. */
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [confirming, setConfirming] = useState<Receipt | null>(null);
  const [busy, setBusy] = useState(false);

  const runMark = async (receipt: Receipt) => {
    if (receipt.donorId === null) return;
    setBusy(true);
    try {
      await markSubmitted({ pickupDate: receipt.pickupDate, donorId: receipt.donorId });
      setConfirming(null);
      toast.success(COPY.marked);
      await onChanged();
    } catch (cause) {
      setConfirming(null);
      toast.error(messageFor(cause));
    } finally {
      setBusy(false);
    }
  };

  /** Un-ticking is a DELETE and asks for no confirmation: it takes a claim back
   *  rather than making one, and the state it lands in is the state everything
   *  started in. The confirm is on the tick, which is what tells somebody else not
   *  to file the store. */
  const runUnmark = async (receipt: Receipt) => {
    if (receipt.donorId === null) return;
    setBusy(true);
    try {
      await clearSubmitted({ pickupDate: receipt.pickupDate, donorId: receipt.donorId });
      toast.success(COPY.unmarked);
      await onChanged();
    } catch (cause) {
      toast.error(messageFor(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="s31-receipts" aria-label={COPY.receiptsLabel}>
      <BackLink label={COPY.backToTotals} onBack={onBack} />

      <header className="s31-receipts__head">
        <h2 className="s31-receipts__title">{COPY.receiptsTitle}</h2>
        <p className="s31-receipts__week">
          {`${COPY.receiptsWeek} ${formatDateRange(sheet.from, sheet.to)}`}
        </p>
        {/* D25 cut the agency line that stood here. The person entering the
            submission is already signed in to the account it belongs to. */}
        {/* D28's whole-pound note, moved here from under the totals (D34): this is
            where a reporter is reading a figure to type it, and it is the only
            place the gap between this screen and Admin metrics can be explained
            beside the number it applies to. */}
        <p className="s31-receipts__note">{COPY.wholePoundsNote}</p>
        <p className="s31-receipts__progress" role="status">
          {submittedProgress(sheet)}
        </p>
        <Button variant="secondary" onClick={() => window.print()}>
          {/* Icon plus words, never the icon alone (§3): "Print" and "Save as PDF"
              are the same button here and only the label can say so. */}
          <PrinterIcon />
          {COPY.print}
        </Button>
      </header>

      {isEmptyExport(sheet) ? (
        <p className="s31-receipts__empty">{COPY.receiptsEmpty}</p>
      ) : (
        <>
          {/* The compact list. Every row carries its own submitted state, so the
              answer to "what is left" is readable without opening anything. */}
          <div className="s31-receipts__list">
            <List label={COPY.receiptListLabel}>
              {sheet.receipts.map((receipt, index) => (
                <ListItem key={receiptKey(receipt, index)}>
                  <ListRow
                    title={receiptRowTitle(receipt)}
                    subtitle={submittedLabel(receipt, timezone)}
                    side={
                      <span
                        className={
                          receipt.submitted !== null
                            ? 's31-receipts__side s31-receipts__side--done'
                            : 's31-receipts__side'
                        }
                      >
                        {weightWithUnit(receipt.totalPounds)}
                      </span>
                    }
                    onClick={() => setOpenIndex(index === openIndex ? null : index)}
                    ariaLabel={receiptRowDescription(receipt, timezone)}
                  />
                </ListItem>
              ))}
            </List>
          </div>

          {/* One card at a time on screen. Under `@media print` every card is
              promoted, because a printout is the whole range on paper and the
              reporter is no longer clicking anything. */}
          <div className="s31-receipts__cards">
            {sheet.receipts.map((receipt, index) => (
              <div
                className={
                  index === openIndex
                    ? 's31-receipts__card'
                    : 's31-receipts__card s31-receipts__card--closed'
                }
                key={receiptKey(receipt, index)}
              >
                <ReceiptCard
                  receipt={receipt}
                  timezone={timezone}
                  busy={busy}
                  onMark={() => setConfirming(receipt)}
                  onUnmark={() => void runUnmark(receipt)}
                />
              </div>
            ))}
          </div>
        </>
      )}

      {/* The confirm asks BEFORE it writes (D35). The consequence is real and is
          not a warning: a tick tells the next reporter the store is already filed,
          and §3 requires a consequence rather than "are you sure". That it is
          undoable is said in the same breath, because it is. */}
      {confirming !== null ? (
        <ConfirmModal
          question={markSubmittedQuestion(confirming)}
          consequence={COPY.markConsequence}
          confirmLabel={COPY.markConfirm}
          busy={busy}
          onConfirm={() => void runMark(confirming)}
          onCancel={() => setConfirming(null)}
        />
      ) : null}

    </section>
  );
}

function ReceiptCard({
  receipt,
  timezone,
  busy,
  onMark,
  onUnmark,
}: {
  receipt: Receipt;
  timezone?: string | undefined;
  busy: boolean;
  onMark: () => void;
  onUnmark: () => void;
}) {
  const empty = receiptEmptyText(receipt);

  return (
    <article
      className="s31-receipt"
      aria-label={`${formatReceiptDate(receipt.pickupDate)}, ${receiptDonorLabel(receipt)}`}
    >
      {/* --- the portal's half ------------------------------------------- */}
      <dl className="s31-receipt__head">
        <div className="s31-receipt__field">
          <dt>{COPY.pickupDate}</dt>
          <dd className="r3-numeric">{formatReceiptDate(receipt.pickupDate)}</dd>
        </div>
        <div className="s31-receipt__field">
          <dt>{COPY.donor}</dt>
          <dd>{receiptDonorLabel(receipt)}</dd>
        </div>
      </dl>

      {/* The two checkboxes are COMPUTED (D29): a skipped stop or a run nobody
          worked ticks the first, a pickup that came to nothing ticks the second.
          Both used to produce no export row at all, which is how a missed pickup
          became invisible to the food bank. Drawn as boxes because that is what
          the portal shows, with the state also in words for anyone who hears the
          card rather than sees it (§3: never a glyph alone). */}
      <ul className="s31-receipt__boxes">
        <Checkbox ticked={receipt.notAttempted} label={COPY.notAttemptedBox} />
        <Checkbox ticked={receipt.noPounds} label={COPY.noPoundsBox} />
      </ul>

      {empty !== null ? (
        <p className="s31-receipt__empty">{empty}</p>
      ) : (
        <table className="s31-receipt__lines">
          <thead>
            <tr>
              <th scope="col">{COPY.colCategory}</th>
              <th scope="col">{COPY.colStorage}</th>
              <th scope="col" className="s31-receipt__pounds">
                {COPY.colPounds}
              </th>
            </tr>
          </thead>
          <tbody>
            {/* One line per AGFP category, NEVER merged: Deli and Frz Non Meat
                both report as `Prepared Meal / Frozen`, and the sample receipt
                carries two separate rows for exactly that reason. Row order is the
                server's and is the only identity two otherwise identical rows
                have, so the index is part of the key. */}
            {receipt.lines.map((line, index) => (
              <tr key={`${line.ntfbCategory}:${line.storage}:${line.agfpCategory}:${index}`}>
                <td>{line.ntfbCategory}</td>
                <td>{line.storage}</td>
                <td className="r3-numeric s31-receipt__pounds">{formatWeight(line.pounds)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <dl className="s31-receipt__totals">
        <div className="s31-receipt__field">
          <dt>{COPY.itemCount}</dt>
          <dd className="r3-numeric">{receipt.itemCount}</dd>
        </div>
        <div className="s31-receipt__field">
          <dt>{COPY.totalPounds}</dt>
          <dd className="r3-numeric">{formatWeight(receipt.totalPounds)}</dd>
        </div>
      </dl>

      {/* --- the check-off (D35) ------------------------------------------ */}
      <div className="s31-receipt__submit">
        <p className="s31-receipt__submit-state">{submittedLabel(receipt, timezone)}</p>
        {canMarkSubmitted(receipt) ? (
          receipt.submitted !== null ? (
            <Button variant="secondary" onClick={onUnmark} disabled={busy}>
              {COPY.unmark}
            </Button>
          ) : (
            <Button variant="primary" onClick={onMark} disabled={busy}>
              {COPY.mark}
            </Button>
          )
        ) : null}
      </div>

      {/* --- ours, below the line ----------------------------------------- */}
      <section className="s31-receipt__ours" aria-label={COPY.oursTitle}>
        <h3 className="s31-receipt__ours-title">
          {COPY.oursTitle}
          <span className="s31-receipt__ours-note">{COPY.oursNote}</span>
        </h3>

        {/* The reading aid. Every line is listed, including Trash — which is
            computed (D27) and says so here, so nobody goes looking for the sheet
            it came from. The pounds are part of the label because the NTFB
            category and storage alone cannot tell two `Prepared Meal / Frozen`
            rows apart, which is the whole reason this block exists. */}
        {receipt.lines.length > 0 ? (
          <>
            <h4 className="s31-receipt__ours-sub">{COPY.oursLineLabel}</h4>
            <dl className="s31-receipt__sources">
              {receipt.lines.map((line, index) => (
                <div
                  className={
                    line.computed
                      ? 's31-receipt__source s31-receipt__source--computed'
                      : 's31-receipt__source'
                  }
                  key={`${line.ntfbCategory}:${line.storage}:${line.agfpCategory}:${index}`}
                >
                  <dt>{receiptLineLabel(line)}</dt>
                  <dd>{receiptLineSource(line)}</dd>
                </div>
              ))}
            </dl>
          </>
        ) : null}

        <h4 className="s31-receipt__ours-sub">{COPY.notesTitle}</h4>
        {receipt.notes.length === 0 ? (
          <p className="s31-receipt__note-empty">{COPY.notesEmpty}</p>
        ) : (
          <>
            <p className="s31-receipt__note-hint">{COPY.notesHint}</p>
            <ul className="s31-receipt__notes">
              {receipt.notes.map((note, index) => (
                <li key={`${note.role}:${index}`}>
                  <span className="s31-receipt__note-role">{`${noteAuthorLabel(note)}: `}</span>
                  {note.text}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </article>
  );
}

function Checkbox({ ticked, label }: { ticked: boolean; label: string }) {
  return (
    <li className="s31-receipt__box">
      {/* The box is a MARK and marks are not read aloud reliably, so the state is
          also a word (§3: never a visual signal alone). Hidden from the page and
          not from a screen reader, rather than put in an `aria-label` on a list
          item, which browsers announce inconsistently. */}
      <span className="s31-receipt__tick" aria-hidden="true">
        {ticked ? TICKED : UNTICKED}
      </span>
      <span className="r3-sr-only">{checkboxDescription(ticked, label)}</span>
      <span aria-hidden="true">{label}</span>
    </li>
  );
}
