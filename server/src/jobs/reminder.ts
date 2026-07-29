// The shift-reminder sweep — `architecture.md §4.4`, PRD notification matrix row
// "Shift reminder (hard-coded 1-hour offset before start) → the owning driver".
//
// A CATCH-UP SWEEP, like every job here: it asks "what is due and unhandled?", never
// "fire at time T". A one-shot timer for a 10:00 run's 09:00 reminder is lost forever
// if the process is restarting at 08:59; this pass catches it on the next tick,
// slightly late. That is the property that makes the in-process interval a
// low-stakes trigger mechanism.
//
// Every minute, because §4.4 fixes the cadence at 1 min for reminders and at-risk —
// it bounds how late the reminder can be, and the query is one indexed read at ~15
// pickups a week.
//
// This file opens no transaction. The write lives in `services/execution.ts`, because
// nothing outside `services/` opens a write transaction and a job is outside
// `services/` (§4.1) — which is also what makes the tier-1 duplicate-send guard
// (`uq_notif_shift_event`) the only thing this job relies on for idempotency, rather
// than any state the scheduler remembers.

import { sendDueShiftReminders } from '../services/execution.js';
import type { Job } from './scheduler.js';

export const shiftReminderJob: Job = {
  name: 'shift-reminder',
  intervalMs: 60_000,
  run: async () => {
    const sent = await sendDueShiftReminders();
    if (sent > 0) {
      // Structured to stdout (§5.4). A count, never a recipient — the log line is
      // for "is the sweep firing", not for who was reminded.
      console.log(JSON.stringify({ event: 'shift_reminders_sent', count: sent }));
    }
  },
};
