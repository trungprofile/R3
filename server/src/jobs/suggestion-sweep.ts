// The other half of I17 (`architecture.md §4.4`).
//
// A `SUGGESTED` UnscheduledDonation is a driver's prefill, waiting for a receiver to
// weigh it and confirm. I17 gives it exactly two ends: receive-done deletes it inline
// (that path is in `services/receive.ts`), or — for a shift that is never received
// against at all — this sweep deletes it once the edit window has expired.
//
// Without this half, the failure is quiet rather than loud: a run nobody ever
// receives keeps its prefills forever, they are unreachable from any screen once the
// window closes, and they would surface in Phase 3 as intake rows with no weight.
// `ck_ud_confirmed_weight` keeps them out of the CONFIRMED set, so they cannot
// corrupt a total — they would just accumulate.
//
// A catch-up sweep like every other job: it asks "which SUGGESTED rows are past their
// shift's window?", so a missed tick or a restart delays the purge instead of losing
// it, and running it late or twice is a no-op (`CLAUDE.md` — jobs ask what is due and
// unhandled, never fire at time T).
//
// Daily, matching the granularity of the thing it watches: the window is measured in
// days (`app_config.receiver_edit_window_days`), so sweeping more often would spend
// transactions to delete the same rows a few hours earlier.

import { purgeExpiredSuggestions } from '../services/donation.js';
import type { Job } from './scheduler.js';

const DAILY_MS = 24 * 60 * 60 * 1000;

export const suggestionSweepJob: Job = {
  name: 'suggestion-sweep',
  intervalMs: DAILY_MS,
  run: async () => {
    const purged = await purgeExpiredSuggestions();
    if (purged > 0) {
      // Structured to stdout (§5.4). A count is enough: these rows carried no weight,
      // so there is no number anyone will later go looking for.
      console.log(JSON.stringify({ event: 'suggestions_purged', count: purged }));
    }
  },
};
