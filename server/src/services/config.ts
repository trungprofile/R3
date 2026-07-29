// Reads of `app_config`, the single-row table holding the pantry's own settings
// (`data-model.md`). Read-only: nothing here opens a transaction, because nothing
// here writes. Editing these settings is an admin operation and does not exist in
// Phase 1.
//
// Why this is a service and not an inline query in a route: `architecture.md §4.1`
// keeps table access behind `services/`, so the day `app_config` gains a cache or a
// second consumer there is one place to change rather than a grep.

import { db } from '../db/index.js';

/**
 * The pantry's IANA zone.
 *
 * Load-bearing for anything a person reads as a wall-clock time. A shift's window
 * is stored as an instant, but it *means* a pantry-local time — "the 9am run" is
 * 9am at the pantry whether the phone reading it is in Chicago or not. Services
 * that render text server-side (push copy, the inbox's arrival times) already read
 * this; it is exposed on the session so the client can render its own times against
 * the same zone instead of the device's.
 */
export async function getPantryTimezone(): Promise<string> {
  const config = await db
    .selectFrom('app_config')
    .select(['timezone'])
    .executeTakeFirstOrThrow();
  return config.timezone;
}
