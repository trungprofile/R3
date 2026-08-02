// S3.2's Intake tab — "per-store and total-intake metrics, including unreported
// donation volume" (PRD cap 16).
//
// The union behind these numbers ignores the reportable flag entirely, which is
// the only reason unreported volume is a number anyone can see. The screen's job
// is to keep the two apart all the way to the eye: two labelled columns, a totals
// row that keeps them apart too, and a bar split the same way.
//
// The three states of §3 ("every list defines all three") come from `useAsyncData`:
// skeleton rows after 300ms, a plain retryable error, and an empty state that says
// what to do next.

import { useCallback } from 'react';
import { Button, EmptyState, ErrorBlock, SkeletonRows } from '../../../components/index.ts';
import { useAsyncData } from '../../../app/index.ts';
import type { IntakeMetrics } from '../../../api/shared.ts';
import { Bars } from './Bars.tsx';
import { IntakeTable } from './IntakeTable.tsx';
import { fetchIntake } from './api.ts';
import { COPY, csvFilename, intakeCsv, type Period } from './metrics.ts';
import { downloadCsv } from './download.ts';

export interface IntakeTabProps {
  period: Period;
}

export function IntakeTab({ period }: IntakeTabProps) {
  const load = useCallback(
    (signal: AbortSignal) => fetchIntake(period, signal),
    [period],
  );
  const intake = useAsyncData<IntakeMetrics>(load);
  const metrics = intake.data;

  return (
    <div>
      <div className="s32-panel__head">
        <h2 className="s32-heading">{COPY.intake.heading}</h2>
        {/* The panel's one primary action, and the only action on the screen:
            S3.2's "none destructive; this is read + export". */}
        {metrics !== null && metrics.stores.length > 0 ? (
          <Button
            variant="primary"
            onClick={() => downloadCsv(csvFilename('intake', period), intakeCsv(metrics))}
          >
            {COPY.intake.export}
          </Button>
        ) : null}
      </div>

      <p className="s32-lede">{COPY.intake.lede}</p>

      {intake.showLoading && metrics === null ? (
        <SkeletonRows rows={6} label={COPY.intake.loading} />
      ) : null}

      {intake.error ? <ErrorBlock error={intake.error} onRetry={intake.reload} /> : null}

      {metrics !== null && metrics.stores.length === 0 && !intake.error ? (
        <EmptyState title={COPY.intake.emptyTitle}>{COPY.intake.emptyBody}</EmptyState>
      ) : null}

      {metrics !== null && metrics.stores.length > 0 ? (
        <>
          <IntakeTable metrics={metrics} />
          {/* The server echoes the window it actually measured the trend against,
              so the comparison is stated from ITS answer rather than from a second
              calculation here that could disagree with it. */}
          <p className="s32-note">
            {COPY.intake.comparedWith(metrics.previousFrom, metrics.previousTo)}
          </p>
          <Bars stores={metrics.stores} />
        </>
      ) : null}
    </div>
  );
}
