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

import { useCallback, useState } from 'react';
import { Button, EmptyState, ErrorBlock, SkeletonRows } from '../../../components/index.ts';
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

  const drivers = driverChoices(state.data ?? []);

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
      onAssigned();
      onClose();
    } catch (cause) {
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

  return (
    <div className="s16-assign">
      <p className="s16-hint">{COPY.assignHint}</p>

      <ChoiceList
        label={COPY.assignHeading}
        items={drivers.map((driver) => ({ id: driver.id, label: fullName(driver) }))}
        value={picked?.id ?? null}
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
            onClick={() => void send(picked, warning !== null)}
          >
            {warning !== null ? COPY.assignAnyway : COPY.assign}
          </Button>
        ) : null}
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
