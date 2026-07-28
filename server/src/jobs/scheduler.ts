// The in-process job scheduler (`architecture.md §4.4`).
//
// Jobs run on intervals inside the Express process — no cron, no worker container,
// no queue. The obvious weakness (jobs die with the app) is exactly what catch-up
// semantics neutralize, which is what demotes the trigger mechanism to a low-stakes
// choice: at this scale it is a few small queries per minute against a database on
// the same box.
//
// EVERY JOB IS A CATCH-UP SWEEP. A job asks "what is due and unhandled?", never
// "fire at time T". A one-shot timer for a 10:00 reminder is lost forever if the
// process is restarting at 09:00; a sweep catches it on the next tick, slightly late.
// Missed ticks self-heal — which is only true if each `run()` re-derives what is due
// from the database rather than from anything this engine remembers.
//
// This file is the engine and is meant to stay closed: adding the recurrence,
// reminder, at-risk or session-cleanup job is a new file plus one line in
// `registry.ts`, never an edit here.

import { JOBS } from './registry.js';

export interface Job {
  /** Stable identifier; appears in logs. */
  name: string;
  /** Sweep cadence. §4.4 fixes these per job: 1 min for reminders/at-risk, daily for the rest. */
  intervalMs: number;
  /**
   * One catch-up pass. Must ask the database what is due and unhandled, and must be
   * safe to run late, twice, or after an arbitrary outage.
   */
  run: () => Promise<void>;
  /**
   * Run one pass at boot rather than waiting a full interval. Defaults to true: the
   * pass right after a restart is precisely the one that heals whatever the restart
   * missed.
   */
  runOnStart?: boolean;
}

export interface SchedulerHandle {
  stop: () => void;
}

function log(payload: Record<string, unknown>): void {
  // Structured to stdout (§5.4). Identifiers only — never credentials, never a
  // subscription endpoint, which is a bearer capability in URL form.
  console.log(JSON.stringify(payload));
}

/**
 * Start every registered job on its own interval.
 *
 * Two properties the engine owns, so no job has to:
 *
 *   1. **No overlap.** A slow pass never has a second copy of itself running
 *      alongside it; the tick is skipped and the next one picks the work up, which is
 *      safe precisely because every job is a catch-up sweep.
 *   2. **A failing job never takes the process down.** Errors are logged and the
 *      interval survives them. The API and the scheduler share one process (§4.5), so
 *      an unhandled rejection here would take HTTP with it.
 */
export function startScheduler(jobs: readonly Job[] = JOBS): SchedulerHandle {
  const timers: NodeJS.Timeout[] = [];
  const running = new Set<string>();
  let stopped = false;

  const tick = async (job: Job): Promise<void> => {
    if (stopped || running.has(job.name)) {
      if (running.has(job.name)) log({ event: 'job_skipped_overlap', job: job.name });
      return;
    }
    running.add(job.name);
    const startedAt = Date.now();
    try {
      await job.run();
    } catch (err) {
      log({
        event: 'job_failed',
        job: job.name,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      running.delete(job.name);
      log({ event: 'job_ran', job: job.name, ms: Date.now() - startedAt });
    }
  };

  for (const job of jobs) {
    const timer = setInterval(() => void tick(job), job.intervalMs);
    // Never hold the process open on the scheduler's account.
    timer.unref?.();
    timers.push(timer);
    if (job.runOnStart !== false) void tick(job);
  }

  log({ event: 'scheduler_started', jobs: jobs.map((j) => j.name) });

  return {
    stop() {
      stopped = true;
      for (const timer of timers) clearInterval(timer);
      timers.length = 0;
    },
  };
}
