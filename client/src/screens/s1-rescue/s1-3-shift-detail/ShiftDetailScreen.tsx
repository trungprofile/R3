// S1.3 Shift detail — one screen, two views, decided by who is looking.
//
// "User/device: owner (phone), staff (desktop)." Both read the same run: its stops
// in order, the truck, the time, and the coordinator→driver note. What differs is
// what they may do with it —
//
//   the owner  — Release run (red), before start only. The conflict banner, if
//                staff assigned them over one (I20's exemption). The note, read-only.
//   staff      — the note, editable. Reassign on an in-progress run's unresolved
//                stops (I30). No release: releasing is the driver's own capability
//                (cap 8), and staff clearing an owner is `unassign`, on S1.6.
//
// A viewer who is neither still reads the run. `GET /shifts/:id` is declared at
// VOLUNTEER because the board is a shared surface (cap 5) and this screen is where a
// row opens; every action on it is authorized again server-side.
//
// This screen also carries the ONLY link on to S1.5. Nothing else in the shell
// navigates to `/pickup/:shiftId` — S1.2 opens a Mine row into S1.3 and S1.4's run
// list does the same — so a driver reaches their own run through here. It is
// rendered quieter than Release, because S1.3 names Release as this screen's one
// primary action and §1 principle 1 allows exactly one.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  atLeastTier,
  hasDuty,
  useAsyncData,
  useCurrentUser,
  useRouter,
  useSession,
  useToast,
} from '../../../app/index.ts';
import type { ScreenProps } from '../../../app/index.ts';
import {
  BackLink,
  Button,
  Card,
  EmptyState,
  ErrorBlock,
  SkeletonRows,
  StatusChip,
} from '../../../components/index.ts';
import { toApiError } from '../../../api/index.ts';
import type { ReleaseRequest, RunDetail, ShiftDetail } from '../../../api/shared.ts';
import { fetchRun, fetchShift, releaseRun, reassignStop, saveStaffNote } from './api.ts';
import {
  COPY,
  capabilitiesFor,
  dayHeading,
  messageFor,
  shouldReloadAfter,
  stopLines,
  timeRange,
  todayInZone,
} from './detail.ts';
import type { DetailViewer, ReassignCandidate, StopLine } from './detail.ts';
import { ReassignDialog } from './ReassignDialog.tsx';
import { ReleaseDialog } from './ReleaseDialog.tsx';
import { StaffNoteCard } from './StaffNoteCard.tsx';
import { StopList } from './StopList.tsx';
import './shift-detail.css';

/** What one load of this screen produces. The run is a second read and is null
 *  until there is one to make (I5 — no stop rows before `IN_PROGRESS`). */
interface Loaded {
  shift: ShiftDetail;
  run: RunDetail | null;
}

export function ShiftDetailScreen({ params }: ScreenProps) {
  const shiftId = params['shiftId'] ?? '';
  const user = useCurrentUser();
  const { timezone } = useSession();
  const { go } = useRouter();
  const toast = useToast();

  const load = useCallback(async (signal: AbortSignal): Promise<Loaded> => {
    const shift = await fetchShift(shiftId, signal);
    // I5 puts `shift_stop` rows on a shift only from `IN_PROGRESS` onward, so the
    // live list is worth a second read only then; before that the route template
    // already on `shift` IS the stop list.
    if (shift.status !== 'IN_PROGRESS') return { shift, run: null };
    try {
      return { shift, run: await fetchRun(shiftId, signal) };
    } catch (cause) {
      // `getRun` is the owner's or staff's. Someone else reading a started run
      // still gets the run's facts and the planned route, which is what this
      // screen is for; an abort or any other failure still propagates.
      if (toApiError(cause).kind === 'forbidden') return { shift, run: null };
      throw cause;
    }
  }, [shiftId]);

  const remote = useAsyncData<Loaded>(load);

  // Held as state because every action here edits it in place: a saved note and a
  // moved stop both come back from the write, so the screen updates without a
  // second round trip.
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  useEffect(() => {
    if (remote.data) setLoaded(remote.data);
  }, [remote.data]);

  const [releasing, setReleasing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reassignTarget, setReassignTarget] = useState<StopLine | null>(null);

  const viewer = useMemo<DetailViewer>(
    () => ({
      id: user.id,
      // Tier is hierarchical, so Admin passes a Staff floor without being named (I1).
      isStaff: atLeastTier(user, 'STAFF'),
      // Duty is set membership — never implied by a tier (I2).
      canDrive: hasDuty(user, 'DRIVE'),
    }),
    [user],
  );

  if (!loaded) {
    if (remote.error) {
      return (
        <div className="s13">
          {/* The run failed to load, so Retry may not be the answer — leaving has to
              be reachable from here too, not only from the loaded screen. */}
          <BackLink label="Board" onBack={() => go('board')} />
          <ErrorBlock error={remote.error} onRetry={remote.reload} />
        </div>
      );
    }
    if (remote.showLoading) {
      return (
        <div className="s13">
          <SkeletonRows rows={4} label={COPY.loading} />
        </div>
      );
    }
    // Under 300ms, nothing at all (§6).
    return null;
  }

  const { shift, run } = loaded;
  const capabilities = capabilitiesFor(shift, viewer);
  const stops = stopLines(shift, run, capabilities);

  async function onSaveNote(note: string | null): Promise<boolean> {
    try {
      const updated = await saveStaffNote(shift.id, note);
      // The write answers with the shift alone; the route's stops did not change.
      setLoaded({ shift: { ...updated, plannedStops: shift.plannedStops }, run });
      toast.success(COPY.staffNoteSaved);
      return true;
    } catch (error) {
      toast.error(messageFor(error));
      if (shouldReloadAfter(error)) remote.reload();
      return false;
    }
  }

  async function onRelease(request: ReleaseRequest) {
    setBusy(true);
    try {
      const result = await releaseRun(shift.id, request);
      setReleasing(false);
      // The server's own sentence, so the count it reports and the words describing
      // it cannot disagree.
      toast.success(result.summary);
      // "returns to board as Open" — and this screen no longer has anything for the
      // driver, since the run is not theirs any more.
      go('board');
    } catch (error) {
      setReleasing(false);
      toast.error(messageFor(error));
      if (shouldReloadAfter(error)) remote.reload();
    } finally {
      setBusy(false);
    }
  }

  async function onReassign(candidate: ReassignCandidate) {
    const line = reassignTarget;
    if (!line?.stopId) return;
    setBusy(true);
    try {
      await reassignStop(shift.id, line.stopId, candidate.shiftId);
      setReassignTarget(null);
      toast.success(COPY.reassignDone(candidate.driverName));
      // Both ends changed: this stop is `REASSIGNED` and the destination has a new
      // row. Re-read rather than patch, so the list matches the server exactly.
      remote.reload();
    } catch (error) {
      toast.error(messageFor(error));
      if (shouldReloadAfter(error)) remote.reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="s13">
      {/* The way out. Until this, the only `go('board')` on the screen fired after a
          successful release, so a viewer who was not releasing anything had nothing
          but the browser's Back button — and on the installed app there is no
          browser chrome to press. */}
      <BackLink label="Board" onBack={() => go('board')} />

      <header className="s13__head">
        {/* The pantry's day decides whether this run is "Today" (A120), not the
            device's — `occurrenceDate` is stated in the pantry's frame. */}
        <p className="s13__day">
          {dayHeading(shift.occurrenceDate, todayInZone(timezone ?? undefined))}
        </p>
        <h1 className="s13__title">{shift.routeName}</h1>
        <p className="s13__when">
          {timeRange(shift.startsAt, shift.endsAt, timezone ?? undefined)}
        </p>
        <p className="s13__chips">
          <StatusChip status={shift.status} mine={capabilities.isOwner} />
          {shift.recurrencePatternId !== null ? (
            <span className="s13__repeats">{COPY.repeatsTag}</span>
          ) : null}
        </p>
      </header>

      {/* I20's staff-assign exemption. Informational only — S1.3 is explicit that
          it never blocks pickup execution, so nothing on this screen is gated on
          it and the driver can still start and work the run. */}
      {capabilities.showConflictBanner ? (
        <p className="s13__conflict" role="status">
          {COPY.conflictBanner}
        </p>
      ) : null}

      {/* I10 makes CANCELLED terminal, so this is the first thing worth knowing
          about the run — above its details rather than under them (§1.7). */}
      {shift.status === 'CANCELLED' ? (
        <EmptyState title={COPY.cancelled}>{COPY.cancelledBody}</EmptyState>
      ) : null}

      <Card ariaLabel={COPY.whenLabel}>
        <dl className="s13__facts">
          <dt>{COPY.driverLabel}</dt>
          <dd>{shift.ownerName ?? COPY.noDriver}</dd>
          <dt>{COPY.truckLabel}</dt>
          {/* I8: no truck until the driver picks one at the start. */}
          <dd>{shift.truckName ?? COPY.unset}</dd>
        </dl>
      </Card>

      <StaffNoteCard
        note={shift.staffNote}
        editable={capabilities.canEditStaffNote}
        onSave={onSaveNote}
      />

      <section className="s13__stops" aria-label={COPY.stopsLabel}>
        <h2 className="s13__section">{COPY.stopsLabel}</h2>
        {stops.lines.length === 0 ? (
          // A started run's list is frozen (I5), so "ask staff to add a store" is
          // only true before the run started — afterwards nothing could reach it.
          stops.source === 'SNAPSHOT' ? (
            <EmptyState title={COPY.noStopsLive}>{COPY.noStopsLiveBody}</EmptyState>
          ) : (
            <EmptyState title={COPY.noStops}>{COPY.noStopsBody}</EmptyState>
          )
        ) : (
          <StopList view={stops} onReassign={setReassignTarget} />
        )}
      </section>

      <div className="s13__actions">
        {capabilities.openRun !== null ? (
          <Button
            // Primary only when Release is not on screen, so this screen always has
            // exactly one high-emphasis button (§1 principle 1).
            variant={capabilities.canRelease ? 'secondary' : 'primary'}
            block
            onClick={() => go('pickup', { shiftId: shift.id })}
          >
            {capabilities.openRun === 'START' ? COPY.startRun : COPY.openRun}
          </Button>
        ) : null}

        {/* S1.3: "Before-start only; in-progress/past hide it." Hidden, not
            disabled — and the server refuses the same request anyway. */}
        {capabilities.canRelease ? (
          <Button variant="danger" block onClick={() => setReleasing(true)}>
            {COPY.release}
          </Button>
        ) : null}
      </div>

      {/* A5: the rule above is right, but an owner who has cancelled a run before
          will look for the red button and not find it. Say why it is gone and who
          can still move the run. Below the actions rather than inside them —
          `.s13__actions` turns into a reversed row on the desktop, which is a
          layout for buttons and not for a sentence. */}
      {capabilities.showStartedNotice ? (
        <p className="s13__started">{COPY.releaseStarted}</p>
      ) : null}

      {releasing ? (
        <ReleaseDialog
          shift={shift}
          busy={busy}
          onCancel={() => setReleasing(false)}
          onConfirm={(request) => void onRelease(request)}
        />
      ) : null}

      {reassignTarget ? (
        <ReassignDialog
          line={reassignTarget}
          currentShiftId={shift.id}
          busy={busy}
          onCancel={() => setReassignTarget(null)}
          onConfirm={(candidate) => void onReassign(candidate)}
        />
      ) : null}
    </div>
  );
}
