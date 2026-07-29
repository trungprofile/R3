// Recurrence materialization — the rolling daily sweep (`architecture.md §4.4`,
// `domain-modeling.md §5.3`).
//
// A CATCH-UP SWEEP, like every job here. It asks "which occurrences inside the
// horizon have no `shift` row?", never "fire at time T", so a missed tick, a restart
// mid-pass, or a box that was off for a week all self-heal on the next run: the
// question is answered from the database each time and nothing is remembered between
// passes. Re-running is free — `uq_shift_occurrence` plus `ON CONFLICT DO NOTHING`
// makes a second insert of the same (pattern, date) a no-op (`data-model.md §9`).
//
// Daily, because the horizon is a rolling year (`app_config.horizon_days`): each pass
// adds at most the one window that just came into range per pattern, and being hours
// late on a row a year out costs nothing.
//
// No transaction is opened here. Jobs are outside `services/`, and nothing outside
// `services/` opens a write transaction — this file calls in through the recurrence
// service, which is what makes "I25 is enforced in the service layer" a guarantee
// rather than a sentence (`architecture.md §4.1`).
//
// Registration is the lead's line in `jobs/registry.ts`; this file only exports the
// job (wave-3 lane rule — three lanes each add one, and three lanes editing one array
// is a guaranteed conflict).

import { materializeDuePatterns } from '../services/recurrence.js';
import type { Job } from './scheduler.js';

const DAILY_MS = 24 * 60 * 60 * 1000;

export const materializationJob: Job = {
  name: 'recurrence-materialization',
  intervalMs: DAILY_MS,
  run: async () => {
    const result = await materializeDuePatterns();

    // Structured to stdout (`architecture.md §5.4`). Counts and pattern ids only —
    // a materialized run carries no PII, and there is nothing here worth a line when
    // the sweep found nothing to do, which is the ordinary case on most days.
    if (result.created > 0 || result.failed.length > 0) {
      console.log(
        JSON.stringify({
          event: 'shifts_materialized',
          patterns: result.patterns,
          created: result.created,
          bornClaimed: result.bornClaimed,
          failedPatterns: result.failed,
        }),
      );
    }
  },
};
