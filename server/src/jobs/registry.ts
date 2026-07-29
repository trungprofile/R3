// The job registry — the one list of what the scheduler runs.
//
// Adding a job is a new file next to this one plus a line in this array. The engine
// (`scheduler.ts`) never changes for a new job, which is the point: §4.4's remaining
// sweeps land in later waves and each should cost one line here.
//
//   | Job | Cadence | Wave |
//   | :---- | :---- | :---- |
//   | push dispatch | on commit + 1 min sweep | 1 (below) |
//   | recurrence materialization (`domain-modeling.md §5.3`) | daily | 3 |
//   | shift reminder, 1 h before start | 1 min | 3 |
//   | at-risk alert, 1 day before an unclaimed shift | 1 min | 3 |
//   | expired-session cleanup | daily | 2 (below) |
//   | purge unconfirmed SUGGESTED donations (I17) | daily | Phase 2 (build-plan D3) |
//
// The receiver edit window is deliberately absent: it only changes what is ALLOWED,
// so it is derived on read. Jobs you do not have cannot fail (§4.4).

import { atRiskJob } from './at-risk.js';
import { materializationJob } from './materialization.js';
import { pushDispatchJob } from './push-dispatch.js';
import { shiftReminderJob } from './reminder.js';
import { sessionCleanupJob } from './session-cleanup.js';
import type { Job } from './scheduler.js';

export const JOBS: readonly Job[] = [
  pushDispatchJob,
  sessionCleanupJob,
  // Wave 3 — the three sweeps the table above scheduled for this wave. Each lane
  // wrote its own file and none registered it: three lanes appending to one array
  // is a guaranteed conflict in a partition that is otherwise file-disjoint.
  materializationJob,
  shiftReminderJob,
  atRiskJob,
];
