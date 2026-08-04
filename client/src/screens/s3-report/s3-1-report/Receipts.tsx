// The range's Meal Connect receipts — one card per `(pickup date, donor)` (D29),
// worked through ONE AT A TIME (D34/D35), and since D54 this IS S3.1.
//
// WHY A CARD AND NOT A TABLE. D13 built a rectangular worksheet on the assumption
// that the far end took a file. It does not: a submitted receipt and screenshots
// of all three entry screens settled that Meal Connect is a FORM a person types
// into, one receipt at a time. So the export mimics the form — Pickup Date, Donor,
// two checkboxes, the line items, then Number of Items and Total Pounds — and a
// Reporter reads one card top to bottom while filling one portal screen.
//
// MASTER AND DETAIL (D55). A list column of every receipt, and a detail column
// holding the one that is open. Two columns on a desktop, which is S3.1's canonical
// device; below that they stack and it is list-then-detail, which is exactly what
// this screen already was. The second column is an affordance, never a requirement.
//
// TWO SECTIONS, AND THE SECOND ONE IS NEW (D56):
//
//   "To file into Meal Connect" — every receipt with a store. The progress bar
//   counts this list and only this list: a receipt with no store cannot be ticked,
//   so counting it promised work with no control to do it with.
//
//   "Not filed to the food bank" — receipts with no store (unchanged), AND
//   confirmed donations somebody marked as not reported. Those are outside the
//   report union entirely (`domain-modeling.md §6`), so before D56 they had no
//   receipt and there was nothing on this screen to flip. Flipping one on moves it
//   into the first section on the next read.
//
// EACH CARD HAS A LINE ACROSS IT, and the halves are different kinds of thing:
//
//   ABOVE  the portal's own fields, in the portal's own words. Typed in.
//   BELOW  ours. The AGFP category behind each line, every note, and the two
//          corrections cap 15 gives the reporter. NOT typed in, and said so.
//
// NOTHING IS BUILT HERE. The receipts come from `GET /report/export`, which is the
// same service call and the same refusal the whole export rests on (A186, D12).
// Re-deriving a total in the browser would be a second path to the same submission
// — one that cannot refuse, and whose short output is invisible at the far end.
//
// PRINTING is `window.print()` and a stylesheet, with no library (D5). `report.css`
// promotes this section to the whole page, but ONLY while `PRINT_BODY_CLASS` is on
// the body — see `ReportScreen`.

import { useState } from 'react';
import { useToast } from '../../../app/index.ts';
import {
  Button,
  ConfirmModal,
  List,
  ListItem,
  ListRow,
  Modal,
  PrinterIcon,
} from '../../../components/index.ts';
import type {
  DonorSummary,
  Receipt,
  ReportEntry,
  ReportExport,
  UnreportedDonation,
} from '../../../api/shared.ts';
import { attachDonor, clearSubmitted, fetchDonors, markSubmitted, setReportable } from './api.ts';
import { Corrections } from './Corrections.tsx';
import {
  COPY,
  TICKED,
  UNTICKED,
  canAttachDonor,
  canMarkSubmitted,
  checkboxDescription,
  entriesForReceipt,
  fileableReceipts,
  formatReceiptDate,
  formatDateRange,
  formatWeight,
  hasUnfiled,
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
  reportableSavedText,
  submittedLabel,
  submittedPercent,
  submittedProgress,
  unfileableReceipts,
  unreportedRowDescription,
  unreportedRowTitle,
  weightWithUnit,
  type DateRange,
} from './report.ts';

export interface ReceiptsProps {
  sheet: ReportExport;
  /** Every entry in the range, fetched once and sifted per receipt (D55). Null
   *  while the first read is in flight — the cards render either way, because the
   *  corrections are an extra on a receipt and not the receipt itself. */
  entries: readonly ReportEntry[] | null;
  /** The window on the wire, for the corrections' writes (D41). */
  range: DateRange;
  /** The pantry's zone, for rendering when a receipt was filed. A submission is an
   *  instant and the pantry's day is what a reporter means by "yesterday" (A120). */
  timezone?: string | undefined;
  /** Told after any write — a tick, an un-tick, a revised weight, a flipped switch.
   *  The range is re-read from the server rather than patched here: every one of
   *  those facts belongs to everyone looking at it, and a revised weight moves a
   *  line, a total and possibly the trash deduction together (D27). */
  onChanged: () => void | Promise<void>;
}

export function Receipts({ sheet, entries, range, timezone, onChanged }: ReceiptsProps) {
  const toast = useToast();
  /** At most one card is open. The portal takes one submission at a time, so this
   *  is the shape of the work rather than a space-saving decision. */
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [confirming, setConfirming] = useState<Receipt | null>(null);
  const [busy, setBusy] = useState(false);
  /** D72 — the label-only card being pointed at a store, and the stores to pick from.
   *  Fetched when the picker opens rather than with the range: most ranges have no
   *  label-only card in them, and a store list nobody looked at is a request between
   *  the reporter and the receipts. */
  const [attaching, setAttaching] = useState<Receipt | null>(null);
  const [donors, setDonors] = useState<DonorSummary[] | null>(null);
  const [donorsError, setDonorsError] = useState<string | null>(null);

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

  /** Section 2's own write: put a held-back donation into the report (D56). The
   *  same `PATCH` the corrections use, and the same service — I16b is checked in
   *  one place and refused with the server's own sentence. */
  const runReport = async (row: UnreportedDonation) => {
    setBusy(true);
    try {
      await setReportable(row.id, true);
      toast.success(reportableSavedText(row.donorName, true));
      await onChanged();
    } catch (cause) {
      toast.error(messageFor(cause));
    } finally {
      setBusy(false);
    }
  };

  /** D72's write. Every donation behind the card moves together, in one transaction
   *  on the server: the card is `(pickup date, label)` and half of it landing on a
   *  store would leave two cards where the reporter saw one.
   *
   *  The refusals are the SERVER's own sentences — I29's on-route guard, an archived
   *  store, an anonymous row. None of them is re-derived here; this screen would be a
   *  second copy of a rule free to disagree with the one that enforces it. */
  const runAttach = async (receipt: Receipt, donorId: string) => {
    setBusy(true);
    try {
      await attachDonor({ donationIds: receipt.labelDonationIds, donorId });
      setAttaching(null);
      toast.success(COPY.attached);
      await onChanged();
    } catch (cause) {
      toast.error(messageFor(cause));
    } finally {
      setBusy(false);
    }
  };

  const openAttach = (receipt: Receipt) => {
    setAttaching(receipt);
    if (donors !== null) return;
    setDonorsError(null);
    void fetchDonors()
      .then(setDonors)
      .catch((cause: unknown) => setDonorsError(messageFor(cause)));
  };

  const percent = submittedPercent(sheet);
  const fileable = fileableReceipts(sheet);
  const unfileable = unfileableReceipts(sheet);

  /** Rows are addressed by their index in `sheet.receipts`, so a row in either
   *  section opens the same card in the detail column. */
  const rowFor = (receipt: Receipt) => sheet.receipts.indexOf(receipt);

  const receiptRow = (receipt: Receipt) => {
    const index = rowFor(receipt);
    const isOpen = index === openIndex;
    return (
      /* D70 — THE RECEIPT BEING FILED LOOKS LIKE IT. Master/detail (D55) put the open
         card in its own column, but the row that opened it read exactly like the
         twenty above it, so a reporter typing into Meal Connect lost their place in
         the list every time they looked back at it.

         FOUR CHANNELS, NEVER COLOUR ALONE (§2): an accent rule down the left edge,
         an indent, a raised and tinted surface, and the title in a heavier weight.
         Any one of them read on its own still says "this one". `aria-current` is the
         fifth, for anyone hearing the list rather than seeing it.

         NOT THE SAME AS SUBMITTED (D56). A filed row is muted — a tick, a byline, and
         a lighter weight on the right — so "done" recedes and "open" advances. The two
         can be true at once and still read as two different facts.

         A plain `<li>` rather than `ListItem`, because the state belongs on the row
         container and neither shared component takes a class or `aria-current`. */
      <li
        className={isOpen ? 's31-receipts__row s31-receipts__row--open' : 's31-receipts__row'}
        key={receiptKey(receipt, index)}
        {...(isOpen ? { 'aria-current': true as const } : {})}
      >
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
              {/* FOUR CHANNELS SAYING THE SAME THING, never colour alone (§2
                  forbids a signal carried by hue): the tick, the word in the chip,
                  the byline under the title, and the lighter muted weight beside
                  it. Green is the fourth and is `--success`, §2's own colour for
                  "reported, submitted".

                  A CHIP RATHER THAN A BARE TICK. QA read the lone glyph as nothing
                  at all — receding turned out to be indistinguishable from absent
                  at a glance, and this list is scanned in a hurry. The chip is not
                  announced twice: `ariaLabel` below is the row's whole name and
                  already says whether it was filed. */}
              {receipt.submitted !== null ? (
                <span className="s31-filed">
                  <span aria-hidden="true">{TICKED}</span>
                  {COPY.submitted}
                </span>
              ) : null}
              {weightWithUnit(receipt.totalPounds)}
            </span>
          }
          onClick={() => setOpenIndex(isOpen ? null : index)}
          ariaLabel={receiptRowDescription(receipt, timezone)}
        />
      </li>
    );
  };

  const open = openIndex === null ? null : sheet.receipts[openIndex] ?? null;

  return (
    <section className="s31-receipts" aria-label={COPY.receiptsLabel}>
      <header className="s31-receipts__head">
        <h2 className="s31-receipts__title">{COPY.receiptsTitle}</h2>
        <p className="s31-receipts__week">
          {`${COPY.receiptsWeek} ${formatDateRange(sheet.from, sheet.to)}`}
        </p>
        {/* D25 cut the agency line that stood here. The person entering the
            submission is already signed in to the account it belongs to. */}
        {/* D69 cut `exportHint` from here. The cards below are one per store per
            day in the portal's own order, each headed with a date and a store, and
            they print Meal Connect's own `Number of Items` and `Total Pounds` — the
            sentence described what the reporter was already looking at. */}
        {/* D28's whole-pound note, ON PAPER ONLY (D69). It is the only thing
            explaining why this screen and Admin metrics sit a pound or two apart,
            so it is not deleted — it is moved to where a reporter has both numbers
            in front of them. Same element, two stylesheets, never two markup paths:
            the precedent is D57, which already hides an unticked Meal Connect
            checkbox on screen and draws it on paper for the same reason. */}
        <p className="s31-receipts__note s31-receipts__note--print">{COPY.wholePoundsNote}</p>

        {/* The bar and the sentence are the SAME fact, and the sentence is the one
            that survives being read aloud (§3: never a visual signal alone). A bar
            with no number is not a status, which is why D56 kept the words. */}
        <div className="s31-progress">
          <p className="s31-receipts__progress" role="status">
            {submittedProgress(sheet)}
          </p>
          <div
            className="s31-progress__track"
            role="progressbar"
            aria-label={COPY.progressBarLabel}
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="s31-progress__fill" style={{ width: `${percent}%` }} />
          </div>
        </div>

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
        <div className="s31-receipts__panes">
          {/* --- master: the list ------------------------------------------- */}
          <div className="s31-receipts__list">
            {fileable.length > 0 ? (
              <section aria-label={COPY.fileableHeading}>
                <h3 className="s31-subheading">{COPY.fileableHeading}</h3>
                <List label={COPY.fileableHeading}>{fileable.map(receiptRow)}</List>
              </section>
            ) : null}

            {hasUnfiled(sheet) ? (
              <section className="s31-unfiled" aria-label={COPY.unfiledHeading}>
                <h3 className="s31-subheading">{COPY.unfiledHeading}</h3>
                <p className="s31-note">{COPY.unfiledHint}</p>
                <List label={COPY.unfiledHeading}>
                  {unfileable.map(receiptRow)}
                  {/* The second kind, and the substance of D56. A donation with
                      the switch off has no receipt at all, so this row IS the
                      control: it carries its own decision rather than opening a
                      card that does not exist. */}
                  {sheet.notReported.map((row) => (
                    <ListItem key={row.id}>
                      <div className="s31-unreported" aria-label={unreportedRowDescription(row)}>
                        <div className="s31-entry__facts">
                          <span className="s31-entry__store">{unreportedRowTitle(row)}</span>
                          <span className="s31-entry__meta">
                            {`${row.categoryName} · ${COPY.loggedByPrefix} ${row.receiverName}`}
                          </span>
                        </div>
                        <span className="r3-numeric s31-entry__weight">
                          {weightWithUnit(row.weight)}
                        </span>
                        {/* I16b: an anonymous walk-in cannot be turned on, so the
                            row SAYS SO instead of offering a control that would be
                            refused — the same courtesy D35 gives a receipt with no
                            store to file under. The server answers the question
                            (`canReport`); this does not re-derive it. */}
                        {row.canReport ? (
                          <Button
                            variant="secondary"
                            onClick={() => void runReport(row)}
                            disabled={busy}
                          >
                            {COPY.reportItNow}
                          </Button>
                        ) : (
                          <span className="s31-unreported__blocked">
                            {COPY.cannotReportState}
                          </span>
                        )}
                      </div>
                    </ListItem>
                  ))}
                </List>
              </section>
            ) : null}
          </div>

          {/* --- detail: the open card ------------------------------------- */}
          {/* Every card is rendered and all but one is hidden. Under `@media print`
              the closed ones come back: a printout is the whole range on paper and
              the reporter is no longer clicking anything. */}
          <div className="s31-receipts__detail">
            {open === null ? <p className="s31-receipts__pick">{COPY.pickAReceipt}</p> : null}

            {sheet.receipts.map((receipt, index) => (
              <div
                className={
                  index === openIndex
                    ? /* D70 — the detail card carries the SAME accent rule and tinted
                         surface as its row, so the two read as one thing across the
                         gap between the columns. */
                      's31-receipts__card s31-receipts__card--open'
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
                  onAttach={() => openAttach(receipt)}
                />
                {/* Cap 15's corrections, on the receipt (D54). Only under the OPEN
                    card: they are a control, and a control under fourteen hidden
                    cards is fourteen sets of state nobody is looking at. */}
                {index === openIndex && entries !== null ? (
                  <Corrections
                    range={range}
                    entries={entriesForReceipt(entries, receipt)}
                    onChanged={onChanged}
                  />
                ) : null}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* The confirm asks BEFORE it writes (D35). The consequence is real and is
          not a warning: a tick tells the next reporter the store is already filed,
          and §3 requires a consequence rather than "are you sure". That it is
          undoable is said in the same breath, because it is. */}
      {/* D72 — the store picker. §1.5 rules out a dropdown where a column of big
          targets fits, and the pantry's store list is short by construction, so this
          is a list of rows like every other "tap your name from a list" in R3.

          NO Confirm STEP. Picking a store IS the answer to the question in the title,
          and it is undoable in the sense that matters — the pounds were already in the
          report before and after; what changes is which receipt they are filed on. The
          modal's Cancel is the calm default (§6).

          A reporter never ADDS a store: donors are admin master data (I21), so an
          absent one is a sentence naming who can add it rather than a text field. */}
      {attaching !== null ? (
        <Modal question={COPY.attachQuestion} onCancel={() => setAttaching(null)} actions={null}>
          <p className="s31-attach__hint">{COPY.attachHint}</p>
          <p className="s31-attach__hint">{COPY.attachKeepsLabel}</p>
          {donorsError !== null ? (
            <p className="s31-error" role="alert">
              {donorsError}
            </p>
          ) : donors === null ? (
            <p className="s31-attach__hint">{COPY.attachLoading}</p>
          ) : donors.length === 0 ? (
            <p className="s31-attach__hint">{COPY.attachEmpty}</p>
          ) : (
            <div className="s31-attach__list">
              <List label={COPY.attachQuestion}>
                {donors.map((donor) => (
                  <ListItem key={donor.id}>
                    <ListRow
                      title={donor.name}
                      {...(donor.address !== null ? { subtitle: donor.address } : {})}
                      onClick={() => void runAttach(attaching, donor.id)}
                    />
                  </ListItem>
                ))}
              </List>
            </div>
          )}
          <p className="s31-attach__hint">{COPY.attachAskAdmin}</p>
        </Modal>
      ) : null}

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
  onAttach,
}: {
  receipt: Receipt;
  timezone?: string | undefined;
  busy: boolean;
  onMark: () => void;
  onUnmark: () => void;
  /** D72 — offered only on a label-only card. */
  onAttach: () => void;
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
          became invisible to the food bank.

          ON SCREEN, ONLY THE TICKED ONE IS DRAWN (D57). An empty box on a screen
          is a control a reporter tries to click, and neither of these is one — they
          are computed facts about the pickup.

          ON PAPER, BOTH ARE DRAWN, ALWAYS, and the divergence is deliberate: the
          printout is a mirror of the portal's own form (D29), and a reporter
          comparing the two needs to see the box they are leaving unticked. That is
          why `--unticked` is hidden by a CSS rule rather than by not rendering it —
          the print block turns it back on. DO NOT "fix" this by dropping the
          element. */}
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
        {/* The card's half of the row's mark (D55: the row and the card are one
            thing across two columns). A reporter who has the card open is looking
            at the card, not the list, so the state has to be legible here too —
            same chip, same colour, and the byline it sits beside is unchanged. */}
        <p className="s31-receipt__submit-state">
          {receipt.submitted !== null ? (
            <span className="s31-filed">
              <span aria-hidden="true">{TICKED}</span>
              {COPY.submitted}
            </span>
          ) : null}
          {submittedLabel(receipt, timezone)}
        </p>
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
        ) : canAttachDonor(receipt) ? (
          /* D72 — the way out of `cannotSubmit`, on the card that says it. The state
             line beside this already explains that the food IS in the report and only
             the filing is stuck, so this button is the next step rather than a
             correction. */
          <Button variant="primary" onClick={onAttach} disabled={busy}>
            {COPY.attach}
          </Button>
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

/**
 * One of Meal Connect's two checkboxes.
 *
 * D57: an UNTICKED box is present in the markup and hidden by CSS, not left
 * unrendered. On screen it would be an empty box nobody can click; on the printed
 * receipt it has to be there, because the print is a mirror of the portal's own
 * form (D29) and a reporter comparing the two is checking the box they are leaving
 * alone. One element, two stylesheets — never two markup paths.
 */
function Checkbox({ ticked, label }: { ticked: boolean; label: string }) {
  return (
    <li className={ticked ? 's31-receipt__box' : 's31-receipt__box s31-receipt__box--unticked'}>
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
