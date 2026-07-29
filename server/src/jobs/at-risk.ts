// At-risk coverage alert — "shift still open 1 day before start" (`architecture.md
// §4.4`, PRD §4 notification matrix).
//
// A catch-up sweep like every other job: it asks the database **what is due and
// unhandled**, never "fire at time T" (§4.4). A one-shot timer set when the shift was
// published would be lost to any restart in between; this pass re-derives the answer
// every minute, so a missed tick makes the alert slightly late instead of absent.
//
// One minute because §4.4 puts the two time-triggered shift alerts on a 1-minute sweep.
// The work is one indexed query against ~15 runs a week (PRD §6), and the `NOT EXISTS`
// on already-sent rows means a quiet day costs exactly that query.
//
// This file opens no transaction: nothing outside `services/` may (§4.1), so the whole
// pass is `sweepAtRiskShifts()` and the job is the trigger plus the log line. The push
// goes out after that transaction commits, never inside it — a SERIALIZABLE retry would
// re-send (§4.4).

import { sweepAtRiskShifts } from '../services/coverage.js';
import { dispatchNow } from './push-dispatch.js';
import type { Job } from './scheduler.js';

export const atRiskJob: Job = {
  name: 'at-risk',
  intervalMs: 60_000,
  run: async () => {
    const alerted = await sweepAtRiskShifts();
    if (alerted > 0) {
      // Structured to stdout (§5.4). A count and nothing else — the run ids belong in
      // the inbox, not in a log line that will be read by an operator.
      console.log(JSON.stringify({ event: 'shifts_at_risk', count: alerted }));
      // "On commit + sweep": prompt delivery here, correctness from the minute sweep.
      dispatchNow();
    }
  },
};
