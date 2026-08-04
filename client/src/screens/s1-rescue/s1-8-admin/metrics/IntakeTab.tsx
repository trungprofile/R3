// S3.2's Intake tab — "per-store and total-intake metrics, including unreported
// donation volume" (PRD cap 16).
//
// The union behind these numbers ignores the reportable flag entirely, which is
// the only reason unreported volume is a number anyone can see. The screen's job
// is to keep the two apart all the way to the eye.
//
// D58 CUT THE SCREEN TO ITS TWO ANSWERS. What was here: a lede restating the
// boundary, a five-column table, a sentence naming the comparison period, and a
// by-store bar chart drawing the same figures again. Four ways of saying two
// numbers. What is here now is the two numbers, big, and the table they break
// down into. "Not reported" is still a fact and still on the payload — it is the
// difference between the two figures below, the same way D34 dropped S3.1's third
// total without dropping what it meant.
//
// The three states of §3 ("every list defines all three") come from `useAsyncData`:
// skeleton rows after 300ms, a plain retryable error, and an empty state that says
// what to do next.

import { useCallback } from 'react';
import { Button, EmptyState, ErrorBlock, SkeletonRows } from '../../../../components/index.ts';
import { useAsyncData } from '../../../../app/index.ts';
import type { IntakeMetrics } from '../../../../api/shared.ts';
import { IntakeTable } from './IntakeTable.tsx';
import { fetchIntake } from './api.ts';
import { COPY, csvFilename, headlineFigures, intakeCsv, type Period } from './metrics.ts';
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

      {intake.showLoading && metrics === null ? (
        <SkeletonRows rows={6} label={COPY.intake.loading} />
      ) : null}

      {intake.error ? <ErrorBlock error={intake.error} onRetry={intake.reload} /> : null}

      {metrics !== null && metrics.stores.length === 0 && !intake.error ? (
        <EmptyState title={COPY.intake.emptyTitle}>{COPY.intake.emptyBody}</EmptyState>
      ) : null}

      {metrics !== null && metrics.stores.length > 0 ? (
        <>
          {/* The two answers, above the breakdown (D58). Emitted as ONE list so
              neither can ever be shown alone — a lone big number with no
              counterpart is exactly how the two get conflated (PRD §3), and it is
              the same guard `totalsView` puts on S3.1. */}
          <dl className="s32-figures" aria-label={COPY.intake.figuresLabel}>
            {headlineFigures(metrics).map((figure) => (
              <div className="s32-figure" key={figure.key}>
                <dt className="s32-figure__label">{figure.label}</dt>
                <dd className="s32-figure__value r3-numeric">{figure.value}</dd>
              </div>
            ))}
          </dl>

          <IntakeTable metrics={metrics} />
        </>
      ) : null}
    </div>
  );
}
