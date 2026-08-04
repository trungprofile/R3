// Setting a driver on a run — PRD cap 6's fallback path, and the one place on this
// screen where a conflict is a WARNING rather than a refusal.
//
// The flow, in the order S1.6 states it: staff taps a name; the app asks the server
// whether that driver conflicts; if they do, the sentence appears inline and staff
// must confirm before anything is written; the assignment then goes through and the
// run carries a flag to the driver. Nothing here decides any of that — I20's
// exemption is enforced in `services/coverage.ts`, twice (once for the preview,
// again inside the assigning transaction), and the sentence staff reads is the
// server's own so the two cannot word it differently.
//
// What staff may NOT confirm through is also the server's call, and this screen only
// reflects it: a driver without the Drive duty, or a deactivated account, is a hard
// refusal for staff as much as for self-select (`logic.ts`'s `assignIsBlocked`).
//
// TWO DIFFERENT QUESTIONS, AND THEY STACK (D74).
//
//   * "Karen is already on a run then" is I20's staff-assign exemption — deliberate
//     override authority over a SCHEDULING conflict, decided by the server, shown
//     inline, and confirmed by pressing "Assign anyway".
//   * "Did you mean to take this run off Karen and give it to Dan?" is a question
//     about the EDIT, decided here, and asked in a modal the same way taking a
//     driver off already asks it. Replacing a driver is the same magnitude of change
//     as removing one and used to confirm nothing.
//
// Both may be on screen for one assignment. Neither stands in for the other.

import { useCallback, useState } from 'react';
import {
  Button,
  ConfirmModal,
  EmptyState,
  ErrorBlock,
  SkeletonRows,
} from '../../../components/index.ts';
import { useAsyncData, useToast } from '../../../app/index.ts';
import type { EligibilityPreviewResponse, ShapedUser, ShiftSummary } from '../../../api/shared.ts';
import { assignDriver, checkEligibility, fetchUsers } from './api.ts';
import { ChoiceList } from './controls.tsx';
import { COPY, assignIsBlocked, driverChoices, failureMessage, fullName } from './logic.ts';

export interface AssignDriverProps {
  run: ShiftSummary;
  /** Reload the runs list once the owner changes. */
  onAssigned: () => void;
  onClose: () => void;
}

export function AssignDriver({ run, onAssigned, onClose }: AssignDriverProps) {
  const toast = useToast();
  const load = useCallback((signal: AbortSignal) => fetchUsers(signal), []);
  const state = useAsyncData<ShapedUser[]>(load);

  const [picked, setPicked] = useState<ShapedUser | null>(null);
  const [preview, setPreview] = useState<EligibilityPreviewResponse | null>(null);
  const [checking, setChecking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmSwap, setConfirmSwap] = useState(false);

  const drivers = driverChoices(state.data ?? []);

  // D74: the run's own driver, and the row the picker opens on. It used to open on
  // nobody, with the current driver sitting unmarked among everyone else — so the
  // one fact staff most needed ("who has it now?") was the one the picker hid.
  // Derived rather than held in state: the list arrives asynchronously, and a
  // useState seeded before it lands would seed with null.
  const current = drivers.find((driver) => driver.id === run.ownerId) ?? null;
  const selected = picked ?? current;

  /** Tapping a name never assigns on its own: the check comes first, because the
   *  warning has to be on screen BEFORE staff confirms (S1.6). */
  const pick = async (driver: ShapedUser) => {
    setPicked(driver);
    setPreview(null);
    setProblem(null);
    setChecking(true);
    try {
      setPreview(await checkEligibility(run.id, driver.id));
    } catch (cause) {
      setProblem(failureMessage(cause));
    } finally {
      setChecking(false);
    }
  };

  const send = async (driver: ShapedUser, confirmConflict: boolean) => {
    setSaving(true);
    setProblem(null);
    try {
      await assignDriver(run.id, driver.id, confirmConflict);
      toast.success(COPY.assigned(driver.firstName));
      setConfirmSwap(false);
      onAssigned();
      onClose();
    } catch (cause) {
      setConfirmSwap(false);
      // A 409 here is either the confirmation this flow exists to collect
      // (`ASSIGN_CONFLICT`, which the preview should already have surfaced) or a
      // refusal staff cannot confirm through (`DRIVER_UNAVAILABLE`). Both arrive
      // with the server's sentence, which is shown verbatim.
      setProblem(failureMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  if (state.showLoading && state.data === null) {
    return <SkeletonRows rows={3} label="Loading drivers" />;
  }
  if (state.error) return <ErrorBlock error={state.error} onRetry={state.reload} />;
  if (drivers.length === 0) {
    return <EmptyState title={COPY.noDrivers}>{COPY.noDriversBody}</EmptyState>;
  }

  const reasons = preview?.eligibility.reasons ?? [];
  const blocked = preview !== null && assignIsBlocked(reasons);
  const warning = preview?.warning ?? null;
  // A swap, not a first assignment: the run has a driver and a different one is
  // chosen. Re-picking the driver already on the run is not a swap and asks nothing.
  const swapping =
    current !== null && picked !== null && picked.id !== current.id;

  return (
    <div className="s16-assign">
      <p className="s16-hint">{COPY.assignHint}</p>

      <ChoiceList
        label={COPY.assignHeading}
        items={drivers.map((driver) => ({
          id: driver.id,
          label: fullName(driver),
          // Marked in words, not by the selected highlight alone — §2 forbids one
          // channel carrying a meaning on its own, and "selected" and "already
          // driving this" are two different facts about the same row.
          ...(driver.id === run.ownerId ? { detail: COPY.currentDriver } : {}),
        }))}
        value={selected?.id ?? null}
        onSelect={(id) => {
          const driver = drivers.find((candidate) => candidate.id === id);
          if (driver) void pick(driver);
        }}
      />

      {checking ? <p className="s16-hint">{COPY.checkingDriver}</p> : null}

      {/* I20's staff-assign exemption: the conflict is stated and staff confirms
          through it. Where the reason is one staff cannot confirm through, the
          same block states it and offers no confirm. */}
      {warning !== null && !checking ? (
        <p className={blocked ? 's16-problem' : 's16-warning'} role="alert">
          {warning}
        </p>
      ) : null}

      {problem ? (
        <p className="s16-problem" role="alert">
          {problem}
        </p>
      ) : null}

      <div className="s16-actions">
        {picked !== null && preview !== null && !checking && !blocked ? (
          <Button
            variant="primary"
            loading={saving}
            onClick={() => {
              // D74. A swap is confirmed first; a first assignment goes straight
              // through, as it always has. I20's conflict confirmation rides along
              // in `confirmConflict` either way — it is a different question and is
              // not satisfied by having answered this one.
              if (swapping) setConfirmSwap(true);
              else void send(picked, warning !== null);
            }}
          >
            {warning !== null ? COPY.assignAnyway : COPY.assign}
          </Button>
        ) : null}
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </div>

      {confirmSwap && picked !== null && current !== null ? (
        <ConfirmModal
          question={COPY.swapDriverQuestion(fullName(current), fullName(picked))}
          consequence={COPY.swapDriverConsequence(fullName(current))}
          confirmLabel={COPY.swapDriverGo}
          busy={saving}
          onConfirm={() => void send(picked, warning !== null)}
          onCancel={() => setConfirmSwap(false)}
        />
      ) : null}
    </div>
  );
}
