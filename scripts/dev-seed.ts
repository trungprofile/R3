// Put a usable world in the dev database, so a person can actually sign in and walk
// the rescue loop. Run via `./scripts/dev.sh --seed`.
//
// DESTRUCTIVE: truncates every table first. Dev-only, never pointed at the box.
//
// Everything here goes through `services/`, deliberately, and NOT through
// `server/test/fixtures.ts`. The fixture factory bypasses the service layer on
// purpose — it arranges preconditions for tests and writes a placeholder
// `credential_hash`, so a fixture-built account CANNOT log in. A seed whose whole
// point is a working login therefore has to use the real create path, which also
// means it exercises §5.1's username generator and I21's create-time validation
// rather than quietly diverging from them.
//
// Two consequences of using the real services, both correct:
//   - `createUser` caps tier at STAFF (PRD cap 1: an Admin is reached by promoting
//     an existing account, never minted directly), so the admin below is created
//     then promoted. That is the same two steps a real deployment takes.
//   - Volunteers get a PIN derived from the last 4 of their phone unless one is
//     passed. Passed explicitly here so the printout is not a guess.

import { db } from '../server/src/db/index.js';
import { sql } from 'kysely';
import { createUser, updateUser } from '../server/src/services/user.js';
import { createDonor } from '../server/src/services/donor.js';
import { createTruck } from '../server/src/services/truck.js';
import { createRoute } from '../server/src/services/pickup-route.js';
import { createShift } from '../server/src/services/schedule.js';
import { getPantryTimezone } from '../server/src/services/config.js';

const PIN = '4321';
const PASSWORD = 'dev-password';

/** Nearly the same list and the same reason as `fixtures.ts`: `app_config` is a
 *  migration-seeded singleton, and wiping it removes the horizon the scheduler reads.
 *
 *  `category` is excluded here for that same reason but NOT in `fixtures.ts`, and the
 *  divergence is deliberate. Migration 0010 seeds the 11 AGFP categories at launch
 *  (cap 17), so they are migration-owned data like `app_config` — truncating them here
 *  would leave a dev database with an empty S1.8 Categories tab and, in Phase 2, an
 *  empty weight-entry keypad, with no way back short of a `--reset`. A test suite wants
 *  the opposite: `masters-category.test.ts` creates all eleven itself and asserts the
 *  table then holds exactly eleven, which is only true from empty. Dev wants a usable
 *  world; a suite wants a known one. */
async function truncateAll(): Promise<void> {
  await sql`
    TRUNCATE TABLE
      notification, session, push_subscription, availability_block,
      shift_stop, shift, recurrence_pattern, route_stop, route, device,
      truck, donor, user_duty, app_user
    RESTART IDENTITY CASCADE
  `.execute(db);
}

/** Pantry-local `YYYY-MM-DD`, `offset` days out. The seed must not use the machine's
 *  zone: a run's date is a pantry-local fact (A120), and near midnight the two
 *  disagree — which is exactly the bug the timezone work existed to remove. */
function pantryDate(timezone: string, offset: number): string {
  const day = new Date(Date.now() + offset * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(day);
}

async function main(): Promise<void> {
  await truncateAll();

  const timezone = await getPantryTimezone();

  // --- People -------------------------------------------------------------
  // Tiers and duties are different kinds of thing (I1 hierarchy, I2 set), and the
  // seed covers the combinations the screens branch on: an admin, a coordinator
  // who does not drive, two drivers, and one driver who is also a receiver.
  const admin = await createUser({
    firstName: 'Ada',
    lastName: 'Grace',
    tier: 'STAFF',
    duties: ['DRIVE', 'RECEIVE', 'REPORT'],
    phone: '5550001111',
    address: '1 Pantry Way',
    credential: PASSWORD,
  });
  await updateUser(admin.user.id, { tier: 'ADMIN', credential: PASSWORD });

  const coordinator = await createUser({
    firstName: 'Sam',
    lastName: 'Okafor',
    tier: 'STAFF',
    duties: ['REPORT'],
    phone: '5550002222',
    address: '2 Pantry Way',
    credential: PASSWORD,
  });

  const karen = await createUser({
    firstName: 'Karen',
    lastName: 'Diaz',
    tier: 'VOLUNTEER',
    duties: ['DRIVE'],
    phone: '5550003333',
    address: '3 Elm St',
    credential: PIN,
  });

  const luis = await createUser({
    firstName: 'Luis',
    lastName: 'Park',
    tier: 'VOLUNTEER',
    duties: ['DRIVE', 'RECEIVE'],
    phone: '5550004444',
    address: '4 Oak St',
    credential: PIN,
  });

  // --- Places and things --------------------------------------------------
  const donors = [];
  for (const [name, address] of [
    ['Northside Grocery', '100 North Ave'],
    ['Riverside Market', '220 River Rd'],
    ['Hilltop Bakery', '18 Hill St'],
    ['Eastgate Foods', '905 East Blvd'],
  ] as const) {
    donors.push(await createDonor({ name, address }));
  }

  await createTruck({ truckName: 'Box Truck', plate: 'AGFP-1' });
  await createTruck({ truckName: 'Van', plate: 'AGFP-2' });

  const morning = await createRoute({
    name: 'Tuesday Morning',
    stops: [donors[0]!.id, donors[1]!.id],
  });
  const afternoon = await createRoute({
    name: 'Thursday Afternoon',
    stops: [donors[2]!.id, donors[3]!.id],
  });

  // --- Runs ---------------------------------------------------------------
  // Unclaimed, so S1.2's board has something to claim and S1.3/S1.7 have something
  // to open. Deliberately NOT pre-claimed: claiming is the one path a person should
  // walk themselves the first time the app is loaded, and a seeded CLAIMED row would
  // hide a broken claim button behind data that already looks right.
  const actor = { id: admin.user.id };
  for (const [route, offset, start, end] of [
    [morning, 0, '09:00', '11:00'],
    [morning, 1, '09:00', '11:00'],
    [afternoon, 1, '14:00', '16:00'],
    [afternoon, 3, '14:00', '16:00'],
  ] as const) {
    await createShift(actor, {
      routeId: route.route.id,
      date: pantryDate(timezone, offset),
      startTime: start,
      endTime: end,
    });
  }

  console.log(`
seeded ${timezone}

  admin        ${admin.user.username}   ${PASSWORD}
  coordinator  ${coordinator.user.username}   ${PASSWORD}   (REPORT only — no board actions)
  driver       ${karen.user.username}   ${PIN}
  driver       ${luis.user.username}   ${PIN}   (also RECEIVE)

  4 donors, 2 trucks, 2 routes, 4 unclaimed runs (today .. +3 days)

Usernames are generated by the real service (§5.1), so they are whatever the
algorithm produced above — not a pattern to guess at.
`);
}

main()
  .then(() => db.destroy())
  .catch(async (error) => {
    console.error(error);
    await db.destroy();
    process.exit(1);
  });
