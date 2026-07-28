// Async work, one import away (`architecture.md §4.4`).
//
// The process entrypoint calls `startScheduler()` once, after Express is up; jobs and
// the API share a single process (§4.5). Nothing else here needs to be reached from
// outside `jobs/`, except `dispatchNow()`, which a business service calls right after
// its transaction commits so a release fans out without waiting for the next sweep.

export { startScheduler, type Job, type SchedulerHandle } from './scheduler.js';
export { JOBS } from './registry.js';
export {
  dispatchNow,
  runPushDispatch,
  pushDispatchJob,
  webPushTransport,
  type DispatchOptions,
  type DispatchSummary,
  type PushTransport,
} from './push-dispatch.js';
