// Build the world QA round 2 tests against — the "realistic two-week world" that
// `docs/features/test-plan.md` §1.2 asks for and that `dev-seed.ts` deliberately is not.
//
// DESTRUCTIVE: truncates every table first, same as `dev-seed.ts`. Dev-only, never
// pointed at the box. Run it with an explicit DATABASE_URL — `dev.sh` exports its own
// and anything run outside the script silently hits whatever `.env` says:
//
//     DATABASE_URL=postgres://r3:r3@localhost:55432/r3_dev npx tsx scripts/qa-world.ts
//
// WHY THIS EXISTS. `dev-seed.ts` gives four accounts and four unclaimed runs, which is
// enough to sign in and nothing else: S3.1 has no closed week to report, S3.2 has no
// prior period to compare against, and the rows the report union is most likely to get
// wrong — a skipped stop, a voided weight, a walk-in, an unreportable donation — do not
// exist at all. A screen cannot be tested against data that would make it interesting.
//
// EVERYTHING GOES THROUGH `services/`, for the same reason `dev-seed.ts` does: the
// service layer is where I1–I30 are enforced, so a world built through it cannot hold a
// state the app itself could not reach. Raw SQL here would let QA chase bugs in rows
// that no user could ever have produced.
//
// TWO THINGS IT DELIBERATELY DOES NOT DO
//
//   1. **It never touches `ntfb_category` or `category.ntfb_storage`.** The rule stands,
//      but the reason changed on 2026-08-02. It used to be that those names were North
//      Texas Food Bank's to give (D12) and a placeholder must never reach a seed file.
//      The pantry has since supplied the real list, so migration 0016 seeds all ten
//      categories and all eleven mappings (D26, retiring D12). This script must leave
//      them alone for the opposite reason: they are now REAL, and a QA fixture that
//      overwrote them would be testing against something the app does not ship with.
//
//   2. **It restores `receiver_edit_window_days` to whatever it found.** Building a
//      closed week means writing weights against runs that started 8–13 days ago, and
//      `requireWindowOpen` would refuse every one of them. So the window is widened for
//      the build and put back afterwards — which leaves the past week's window closed,
//      exactly the state D9's "the receiver can no longer edit, the Reporter still can"
//      pair needs to be tested from.

import { sql } from 'kysely';
import { db } from '../server/src/db/index.js';
import { getPantryTimezone } from '../server/src/services/config.js';
import { createUser, updateUser, removeUser } from '../server/src/services/user.js';
import { createDonor, updateDonor } from '../server/src/services/donor.js';
import { createTruck, updateTruck } from '../server/src/services/truck.js';
import { createRoute } from '../server/src/services/pickup-route.js';
import { createShift } from '../server/src/services/schedule.js';
import { createPattern, materializePattern } from '../server/src/services/recurrence.js';
import { claimShift, assignDriver } from '../server/src/services/coverage.js';
import {
  startRun,
  resolveStop,
  completePickup,
  reassignStop,
} from '../server/src/services/execution.js';
import { addWeight, voidWeight, receiveDone } from '../server/src/services/receive.js';
import { createDonation, flagAdHoc } from '../server/src/services/donation.js';
import { listCategories } from '../server/src/services/category.js';
import { listShifts } from '../server/src/services/schedule.js';

const PIN = '4321';
const PASSWORD = 'dev-password';

// ---------------------------------------------------------------------------
// Dates. Everything is pantry-local (A120) and anchored on the ISO Monday, because
// that is the boundary S3.1 and the board both cut on (`client/src/app/week.ts`).
// ---------------------------------------------------------------------------

function pantryToday(timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const at = new Date(Date.UTC(y!, m! - 1, d!));
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/** ISO weekday, Monday = 1. */
function weekday(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  const day = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
  return day === 0 ? 7 : day;
}

function mondayOf(iso: string): string {
  return addDays(iso, 1 - weekday(iso));
}

// ---------------------------------------------------------------------------
// Weight bookkeeping. The script totals what it wrote, so Pass 5 and Lane B have a
// third opinion to check S3.1 and S3.2 against. One source claiming success is not
// evidence; three agreeing is.
// ---------------------------------------------------------------------------

const ledger: { week: string; label: string; weight: string; reportable: boolean }[] = [];

function record(week: string, label: string, weight: string, reportable = true): void {
  ledger.push({ week, label, weight, reportable });
}

/** Decimal-string addition, the same way `services/report.ts` does it — a float sum is
 *  one of the three ways `phases-1-3.md` §1 says this number goes quietly wrong. */
function total(rows: { weight: string }[]): string {
  const cents = rows.reduce((sum, row) => sum + Math.round(Number(row.weight) * 100), 0);
  return (cents / 100).toFixed(2);
}

async function truncateAll(): Promise<void> {
  await sql`
    TRUNCATE TABLE
      notification, session, push_subscription, availability_block,
      weight_entry, unscheduled_donation,
      shift_stop, shift, recurrence_pattern, route_stop, route, device,
      truck, donor, user_duty, app_user
    RESTART IDENTITY CASCADE
  `.execute(db);
}

/** The widened window used only while building. Distinctive on purpose — see below. */
const BUILD_WINDOW_DAYS = 400;

/** Migration 0001's default, and the value to fall back to. */
const DEFAULT_WINDOW_DAYS = 7;

async function setReceiverWindow(days: number): Promise<number> {
  const before = await db
    .selectFrom('app_config')
    .select('receiver_edit_window_days')
    .executeTakeFirstOrThrow();
  await db
    .updateTable('app_config')
    .set({ receiver_edit_window_days: days })
    .execute();
  // A crashed run leaves the widened value behind, and the next run would then "restore"
  // 400 as if it were the pantry's setting — a receiver window that never closes, which
  // is precisely the thing D9 exists to test. So the sentinel is never adopted.
  return before.receiver_edit_window_days === BUILD_WINDOW_DAYS
    ? DEFAULT_WINDOW_DAYS
    : before.receiver_edit_window_days;
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  await truncateAll();
  const timezone = await getPantryTimezone();
  const today = pantryToday(timezone);
  const thisMonday = mondayOf(today);
  const prevMonday = addDays(thisMonday, -7);
  const nextMonday = addDays(thisMonday, 7);

  const windowWas = await setReceiverWindow(BUILD_WINDOW_DAYS);

  // --- People -------------------------------------------------------------
  // The four `dev-seed.ts` accounts keep their names and credentials, so the runbook's
  // login table still works. The rest exist because a screen branches on them.
  const admin = await createUser({
    firstName: 'Ada', lastName: 'Grace', tier: 'STAFF',
    duties: ['DRIVE', 'RECEIVE', 'REPORT'],
    phone: '5550001111', address: '1 Pantry Way', credential: PASSWORD,
  });
  await updateUser(admin.user.id, { tier: 'ADMIN', credential: PASSWORD });

  const coordinator = await createUser({
    // STAFF + DRIVE: the two-duties-on-one-account case D59 turns on, without the
    // admin tier confounding what the screen offers.
    firstName: 'Sam', lastName: 'Okafor', tier: 'STAFF', duties: ['DRIVE'],
    phone: '5550002222', address: '2 Pantry Way', credential: PASSWORD,
  });

  const karen = await createUser({
    firstName: 'Karen', lastName: 'Diaz', tier: 'VOLUNTEER', duties: ['DRIVE'],
    phone: '5550003333', address: '3 Elm St', credential: PIN,
  });

  const luis = await createUser({
    firstName: 'Luis', lastName: 'Park', tier: 'VOLUNTEER', duties: ['DRIVE', 'RECEIVE'],
    phone: '5550004444', address: '4 Oak St', credential: PIN,
  });

  // A112 — a volunteer with NO duties. The read-only case, and the one persona whose
  // board has no action on it at all.
  const nina = await createUser({
    firstName: 'Nina', lastName: 'Torres', tier: 'VOLUNTEER', duties: [],
    phone: '5550005555', address: '5 Pine St', credential: PIN,
  });

  // RECEIVE without REPORT, so the negative-access probe has someone to be refused
  // from `/api/report/*` with (test-plan §4).
  const priya = await createUser({
    firstName: 'Priya', lastName: 'Shah', tier: 'VOLUNTEER', duties: ['RECEIVE'],
    phone: '5550006666', address: '6 Cedar St', credential: PIN,
  });

  // Owns a recurring instance and is then deactivated — I21's "history, so soft-delete"
  // branch, and the state that makes a materialized run's owner unreachable.
  const omar = await createUser({
    firstName: 'Omar', lastName: 'Reyes', tier: 'VOLUNTEER', duties: ['DRIVE'],
    phone: '5550007777', address: '7 Birch St', credential: PIN,
  });

  // Two drivers Lane B owns outright, so a race it loses on purpose never disturbs a
  // run a browser pass is looking at.
  const rosa = await createUser({
    firstName: 'Rosa', lastName: 'Lin', tier: 'VOLUNTEER', duties: ['DRIVE', 'RECEIVE'],
    phone: '5550008888', address: '8 Walnut St', credential: PIN,
  });
  const tom = await createUser({
    firstName: 'Tom', lastName: 'Bell', tier: 'VOLUNTEER', duties: ['DRIVE', 'RECEIVE'],
    phone: '5550009999', address: '9 Maple St', credential: PIN,
  });

  const staff = { id: admin.user.id };
  const adminActor = { id: admin.user.id, tier: 'ADMIN' as const };

  // --- Places and things --------------------------------------------------
  const donorSpecs = [
    ['Northside Grocery', '100 North Ave'],
    ['Riverside Market', '220 River Rd'],
    ['Hilltop Bakery', '18 Hill St'],
    ['Eastgate Foods', '905 East Blvd'],
    ['Lakeview Deli', '77 Lake Dr'],
    ['Southgate Produce', '410 South Pkwy'],
  ] as const;
  const donors = [];
  for (const [name, address] of donorSpecs) {
    donors.push(await createDonor({ name, address }));
  }

  // One donor per route carries an explicit map link and its neighbour carries none, so
  // whichever run a driver opens shows both branches side by side: the stored link, and
  // the one S1.5 derives from the address (D20). A first draft put the only link on the
  // morning route, and Pass 1 could not reach that branch at all without mutating a run
  // another pass was standing on.
  await updateDonor(donors[0]!.id, {
    mapUrl: 'https://maps.app.goo.gl/example-northside',
  });
  await updateDonor(donors[2]!.id, {
    mapUrl: 'https://maps.app.goo.gl/example-hilltop',
  });

  // D27 — one store on the "Sam's and Costco" profile, the rest on the pantry default.
  // Northside Grocery is stop 1 of the morning route, so the closed week exercises BOTH
  // branches of the rate lookup: an explicit per-donor override here, and the
  // app_config fallback on every other store. A world where every donor used the
  // default would let a broken `donor.trash_rate_* ?? app_config.trash_rate_*` pass.
  //
  // Only `produce` differs (0.10 against the default 0.05); bakery and deli are left
  // NULL deliberately, so a single store proves that a partial override falls back
  // per-column rather than all-or-nothing.
  await updateDonor(donors[0]!.id, { trashRateProduce: '0.1000' });

  const boxTruck = await createTruck({ truckName: 'Box Truck', plate: 'AGFP-1' });
  const van = await createTruck({ truckName: 'Van', plate: 'AGFP-2' });
  // Out of service, so the driver's truck picker has something it must NOT offer (I21).
  const oldVan = await createTruck({ truckName: 'Old Van', plate: 'AGFP-0' });
  await updateTruck(oldVan.id, { active: false });

  const morning = await createRoute({
    name: 'Tuesday Morning',
    stops: [donors[0]!.id, donors[1]!.id],
    // D19 — a default, not a fifth note channel. Every run minted from this route
    // starts with it in `shift.staff_note`, and editing it later must not reach back.
    defaultStaffNote: 'Ring the bell at the loading dock; the door is usually locked.',
  });
  const afternoon = await createRoute({
    name: 'Thursday Afternoon',
    stops: [donors[2]!.id, donors[3]!.id],
  });
  const raceRoute = await createRoute({
    name: 'Race Route (Lane B only)',
    stops: [donors[4]!.id, donors[5]!.id],
  });

  const categories = await listCategories();
  const byName = (name: string) => {
    const found = categories.find((c) => c.name.toLowerCase().includes(name.toLowerCase()));
    if (!found) throw new Error(`no category matching "${name}" — migration 0010 changed?`);
    return found.id;
  };
  // Four different categories, so the report has more than one line and the roll-up is
  // worth checking. Matched loosely on purpose: the eleven names are migration 0010's,
  // and this script should fail loudly if they move rather than silently pick the wrong one.
  const PRODUCE = byName('produce');
  const BAKERY = byName('bakery');
  const DAIRY = byName('dairy');
  const MEAT = byName('meat');

  // --- A run, start to finish ---------------------------------------------
  // The whole rescue loop, as a function, because the difference between a closed run
  // and an in-progress one is only how far down this list you stop.
  async function buildRun(opts: {
    route: { route: { id: string } };
    date: string;
    start: string;
    end: string;
    driver?: { user: { id: string } };
    truck?: { id: string };
    stopUpTo?: 'OPEN' | 'CLAIMED' | 'IN_PROGRESS' | 'PICKED_UP' | 'COMPLETED';
    /** disposition per stop position, driver-side */
    dispositions?: ('COLLECTED' | 'SKIPPED')[];
    /** driver->receiver note per stop position (`ShiftStop.note`, PRD cap 11 channel 3).
     *  D29 gave these a second reader: they ride onto the Meal Connect receipt, so a
     *  world with none leaves the receipt's whole Notes block unexercised. Skipping is
     *  reason-free by spec, which makes this the ONLY way a driver can say why. */
    stopNotes?: (string | null)[];
    /** the driver's whole-run note (`Shift.note`), written at "Complete this run" */
    runNote?: string;
    /** the coordinator's note to the driver (`Shift.staff_note`) */
    staffNote?: string;
    /** weights the receiver enters, keyed by stop position */
    weights?: { position: number; categoryId: string; weight: string; note?: string }[];
    /** entered and then voided, before the run closes — I13's void-and-reinsert leaves
     *  the original row in place, and nothing downstream may count it */
    voided?: { position: number; categoryId: string; weight: string }[];
    receiver?: { user: { id: string } };
    week?: string;
  }): Promise<string> {
    const created = await createShift(staff, {
      routeId: opts.route.route.id,
      date: opts.date,
      startTime: opts.start,
      endTime: opts.end,
    });
    const shiftId = created.shift.shift.id;
    const upTo = opts.stopUpTo ?? 'COMPLETED';
    if (upTo === 'OPEN') return shiftId;

    const driver = opts.driver ?? karen;
    await claimShift({ id: driver.user.id, tier: 'VOLUNTEER' }, shiftId);
    if (upTo === 'CLAIMED') return shiftId;

    const run = await startRun(
      { id: driver.user.id, tier: 'VOLUNTEER' },
      shiftId,
      { truckId: (opts.truck ?? boxTruck).id },
    );
    if (upTo === 'IN_PROGRESS' && !opts.dispositions) return shiftId;

    const stops = run.stops;
    const dispositions = opts.dispositions ?? stops.map(() => 'COLLECTED' as const);
    for (const [index, stop] of stops.entries()) {
      const disposition = dispositions[index];
      if (!disposition) continue; // left PENDING on purpose
      const stopNote = opts.stopNotes?.[index];
      await resolveStop({ id: driver.user.id, tier: 'VOLUNTEER' }, shiftId, stop.id, {
        disposition,
        ...(stopNote ? { note: stopNote } : {}),
      });
    }
    if (upTo === 'IN_PROGRESS') return shiftId;

    await completePickup(
      { id: driver.user.id, tier: 'VOLUNTEER' },
      shiftId,
      opts.runNote ? { note: opts.runNote } : {},
    );
    if (upTo === 'PICKED_UP') return shiftId;

    const receiver = opts.receiver ?? luis;
    for (const entry of opts.weights ?? []) {
      const stop = stops[entry.position];
      if (!stop) continue;
      await addWeight({ id: receiver.user.id }, shiftId, stop.id, {
        categoryId: entry.categoryId,
        weight: entry.weight,
        ...(entry.note ? { note: entry.note } : {}),
      });
      record(opts.week ?? 'unknown', `${opts.date} ${stop.donorName}`, entry.weight);
    }
    for (const entry of opts.voided ?? []) {
      const stop = stops[entry.position];
      if (!stop) continue;
      const sheet = await addWeight({ id: receiver.user.id }, shiftId, stop.id, {
        categoryId: entry.categoryId,
        weight: entry.weight,
      });
      const added = sheet.tiles
        .find((tile) => tile.categoryId === entry.categoryId)
        ?.entries.at(-1);
      if (added) await voidWeight({ id: receiver.user.id }, shiftId, stop.id, added.id);
    }
    await receiveDone({ id: receiver.user.id }, shiftId);
    return shiftId;
  }

  // --- The closed week (last Mon–Sun) -------------------------------------
  // Every stop resolved, every weight in, every run COMPLETED. This is the week S3.1
  // reports on with a known answer and S3.2 compares the current period against.
  const closedRun1 = await buildRun({
    route: morning, date: addDays(prevMonday, 1), start: '09:00', end: '11:00',
    // Notes on three of the five channels D29 puts on a receipt, so the Notes block
    // is actually exercised rather than rendering empty on every card.
    runNote: 'Ran about twenty minutes late, the van needed fuel.',
    stopNotes: ['Back dock was blocked, went in the front.', null],
    weights: [
      { position: 0, categoryId: PRODUCE, weight: '120.50' },
      { position: 0, categoryId: BAKERY, weight: '45.25' },
      { position: 1, categoryId: DAIRY, weight: '200.00', note: 'Two crates of milk were past date, left them.' },
    ],
    // A voided weight (I13) — added, then voided, so the report must NOT count it and
    // the audit trail must still resolve. `A169` makes a voided row count as history.
    voided: [{ position: 0, categoryId: PRODUCE, weight: '999.00' }],
    week: 'closed',
  });

  // One driver-SKIPPED stop, so the report union has a stop that produced nothing.
  //
  // D29 gave this a second job: a SKIPPED stop is now the `Scheduled Pickup Not
  // Attempted` receipt, which before this round produced no export row at all and was
  // therefore invisible to the food bank. The receipt must carry zero lines and the
  // driver's reason in its Notes.
  await buildRun({
    route: afternoon, date: addDays(prevMonday, 3), start: '14:00', end: '16:00',
    dispositions: ['COLLECTED', 'SKIPPED'],
    // Skipping is reason-free by spec (S1.5: "a Skip action with reason-free confirm"),
    // so a stop note is the ONLY way a driver can say why nobody picked up. That makes
    // this note the entire content of the not-attempted receipt, and the exact sentence
    // the pantry asked to see reach the food bank.
    stopNotes: [null, 'Store was not open at the scheduled time.'],
    weights: [{ position: 0, categoryId: BAKERY, weight: '80.00' }],
    week: 'closed',
  });

  // The OTHER empty-handed case, and a different checkbox: a stop the driver worked
  // and weighed at nothing. `No Pounds` rather than `Scheduled Pickup Not Attempted`,
  // and the two must not be confused — one says nobody went, the other says somebody
  // went and there was nothing to take. Adds 0.00 lb, so every total above is
  // untouched and the closed week's arithmetic still reconciles.
  await buildRun({
    route: afternoon, date: addDays(prevMonday, 4), start: '14:00', end: '16:00',
    weights: [
      { position: 0, categoryId: BAKERY, weight: '0.00' },
      { position: 1, categoryId: PRODUCE, weight: '0.00' },
    ],
    week: 'closed',
  });

  // A run picked up fifteen days ago and never received. Fully weighed, every stop
  // resolved, still IN_PROGRESS.
  //
  // This is the ONLY state in which D9's window gate is observable. `requireReceivable`
  // checks status before it checks the window, so a COMPLETED run answers "already
  // finished" and the window question is never asked — which is how the first attempt to
  // test D9 came back green while proving nothing. It is also a real state: a driver
  // finishes on a Friday, nobody at the dock closes it out, and a fortnight later the
  // receiver opens it. That is precisely when the pair matters — the receiver is refused
  // and pointed at the Reporter, but `receiveDone` is NOT window-gated, so the run can
  // still be closed rather than stranded in IN_PROGRESS forever.
  await buildRun({
    route: afternoon, date: addDays(today, -15), start: '13:00', end: '15:00',
    driver: karen, truck: van,
    stopUpTo: 'PICKED_UP',
  });
  {
    const lapsed = await db
      .selectFrom('shift')
      .select(['id'])
      .where('status', '=', 'IN_PROGRESS')
      // Cast in SQL rather than passing the bare string: `occurrence_date` is a date
      // column, and this is the same reason `coverage.ts` casts on its range edges — a
      // calendar slot compared as an instant is off by the pantry's UTC offset.
      .where('occurrence_date', '=', sql<Date>`${addDays(today, -15)}::date`)
      .executeTakeFirstOrThrow();
    const stops = await db
      .selectFrom('shift_stop').select(['id']).where('shift_id', '=', lapsed.id)
      .orderBy('position').execute();
    for (const stop of stops) {
      await addWeight({ id: luis.user.id }, lapsed.id, stop.id, {
        categoryId: BAKERY, weight: '10.00',
      });
    }
    // NOT recorded in the ledger: it is two weeks old and lands in neither week the
    // report totals below are about.
  }

  // Two walk-ins. The second is NOT reportable — the pantry counts it, NTFB never sees
  // it, and `intakeTotal - reportedTotal` is exactly this row. Two numbers that must
  // stay distinguishable everywhere (PRD §3).
  //
  // THEY LAND IN THE CURRENT WEEK, NOT THE CLOSED ONE, and there is no way to ask for
  // otherwise. A walk-in has no shift and therefore no `occurrence_date` (D10), so its
  // `report_day` is `received_date`, which `createDonation` takes from the pantry clock
  // — today. This script's first draft filed them under the closed week and disagreed
  // with S3.1 by exactly 60 lb; the app was right. The union's date rule is
  // `data-model.md §8`, and this is what it looks like from the outside.
  await createDonation({ id: luis.user.id }, {
    donorId: donors[4]!.id, categoryId: MEAT, weight: '60.00', reportable: true,
  });
  record('current', 'walk-in Lakeview Deli (received today)', '60.00', true);
  await createDonation({ id: luis.user.id }, {
    donorLabel: 'Neighbour drop-off', categoryId: PRODUCE, weight: '15.75',
    reportable: false,
  });
  record('current', 'walk-in Neighbour drop-off (not reported)', '15.75', false);

  // --- This week (Mon–today) ----------------------------------------------
  await buildRun({
    route: morning, date: thisMonday, start: '09:00', end: '11:00',
    weights: [
      { position: 0, categoryId: PRODUCE, weight: '95.00' },
      { position: 1, categoryId: DAIRY, weight: '150.25' },
    ],
    week: 'current',
  });

  // In progress, one stop still PENDING — this is what makes S3.1's "incomplete week"
  // state reachable (A184) and gives S2.x a run to receive against.
  const liveRun = await buildRun({
    route: afternoon, date: addDays(thisMonday, 2), start: '14:00', end: '16:00',
    driver: karen, truck: van,
    stopUpTo: 'IN_PROGRESS', dispositions: ['COLLECTED'],
  });

  // A driver-flagged ad-hoc donation — the prefill S2.3 confirms. D8: a flag REQUIRES a
  // category, and it carries no weight until the receiver puts one on it. The store must
  // be OFF this run: a donor already on it is a stop, and the service says so.
  // D24: no category. The driver cannot know it, so the row arrives category-less
  // and the receiver picks one when they confirm it on S2.3.
  await flagAdHoc({ id: karen.user.id }, liveRun, {
    donorId: donors[4]!.id, note: 'Two extra bread trays, unweighed.',
  });

  // A second in-progress run so a stop has somewhere to be reassigned TO (I30).
  const spareRun = await buildRun({
    route: morning, date: addDays(thisMonday, 2), start: '15:00', end: '17:00',
    driver: luis, truck: boxTruck, stopUpTo: 'IN_PROGRESS',
  });

  let reassignedNote = 'not attempted';
  try {
    const pending = await db
      .selectFrom('shift_stop').select(['id']).where('shift_id', '=', liveRun)
      .where('disposition', '=', 'PENDING').orderBy('position').executeTakeFirst();
    if (pending) {
      await reassignStop(adminActor, liveRun, pending.id, { toShiftId: spareRun });
      reassignedNote = `one stop moved from the Wed run to the spare run`;
    }
  } catch (error) {
    reassignedNote = `REFUSED: ${(error as Error).message}`;
  }

  // Claimed but not started, and two still open — the board needs all three states, and
  // Pass 1 needs something a driver can actually claim today.
  await buildRun({
    route: morning, date: addDays(thisMonday, 4), start: '09:00', end: '11:00',
    driver: karen, stopUpTo: 'CLAIMED',
  });
  await buildRun({
    route: afternoon, date: today, start: '14:00', end: '16:00', stopUpTo: 'OPEN',
  });
  await buildRun({
    route: morning, date: addDays(nextMonday, 1), start: '09:00', end: '11:00',
    stopUpTo: 'OPEN',
  });

  // --- A recurring pattern ------------------------------------------------
  // Materialized instances in three states: one claimed by an active driver, one open,
  // and one whose owner was deactivated afterwards.
  const pattern = await createPattern(staff, {
    routeId: afternoon.route.id,
    weekdays: [2],
    startTime: '10:00',
    endTime: '12:00',
    endDate: null,
  });
  await materializePattern(pattern.pattern.id);

  const instances = await listShifts({ patternId: pattern.pattern.id });
  const open = instances.filter((s) => s.status === 'OPEN').sort(
    (a, b) => String(a.occurrence_date).localeCompare(String(b.occurrence_date)),
  );
  if (open[0]) {
    await claimShift({ id: karen.user.id, tier: 'VOLUNTEER' }, open[0].id);
  }
  let deactivatedOwnerRun = 'none';
  if (open[1]) {
    await assignDriver(adminActor, open[1].id, { driverId: omar.user.id });
    deactivatedOwnerRun = String(open[1].occurrence_date);
  }
  // Deactivate AFTER assigning, so I21 takes the soft-delete branch and the run keeps an
  // owner who can no longer sign in — the coverage gap the at-risk sweep should notice.
  await removeUser(omar.user.id);

  // --- Lane B's race fixtures ---------------------------------------------
  // Its own route and its own drivers, so a race that deliberately loses never mutates a
  // run a browser pass is standing on.
  const raceClaim = await buildRun({
    route: raceRoute, date: addDays(nextMonday, 1), start: '08:00', end: '10:00',
    stopUpTo: 'OPEN',
  });
  const raceWeigh = await buildRun({
    route: raceRoute, date: addDays(nextMonday, 2), start: '08:00', end: '10:00',
    driver: rosa, truck: van, stopUpTo: 'PICKED_UP',
  });
  const raceMoveFrom = await buildRun({
    route: raceRoute, date: addDays(nextMonday, 3), start: '08:00', end: '10:00',
    driver: rosa, truck: van, stopUpTo: 'IN_PROGRESS',
  });
  const raceMoveTo = await buildRun({
    route: raceRoute, date: addDays(nextMonday, 3), start: '11:00', end: '13:00',
    driver: tom, truck: boxTruck, stopUpTo: 'IN_PROGRESS',
  });

  await setReceiverWindow(windowWas);

  // --- What was built -----------------------------------------------------
  const closed = ledger.filter((l) => l.week === 'closed');
  const current = ledger.filter((l) => l.week === 'current');
  const closedReported = closed.filter((l) => l.reportable);
  const currentReported = current.filter((l) => l.reportable);

  console.log(`
QA world built — ${timezone}, today is ${today}

  Signing in
    admin        ${admin.user.username}   ${PASSWORD}
    coordinator  ${coordinator.user.username}   ${PASSWORD}   (STAFF + DRIVE — the D59 overlap)
    driver       ${karen.user.username}   ${PIN}
    driver       ${luis.user.username}   ${PIN}   (also RECEIVE)
    no duties    ${nina.user.username}   ${PIN}   (A112 read-only)
    receive only ${priya.user.username}   ${PIN}   (refused on /report)
    deactivated  ${omar.user.username}   (owns a recurring run, cannot sign in)
    Lane B       ${rosa.user.username} / ${tom.user.username}   ${PIN}

  Weeks
    closed        ${prevMonday} .. ${addDays(prevMonday, 6)}   every run COMPLETED
    in progress   ${thisMonday} .. ${addDays(thisMonday, 6)}   mixed states
    ahead         ${nextMonday} ..                             open + Lane B fixtures

  Rows the report union is most likely to get wrong
    voided weight        999.00 on ${addDays(prevMonday, 1)}, must not appear anywhere
    driver-skipped stop  Eastgate Foods on ${addDays(prevMonday, 3)}
    reassigned stop      ${reassignedNote}
    walk-in, reported    60.00 Lakeview Deli
    walk-in, NOT reported 15.75 Neighbour drop-off
    deactivated owner    recurring run on ${deactivatedOwnerRun}

  Trash deduction (D27) — the store profiles this world covers
    Northside Grocery  produce 10%, bakery and deli fall back to the pantry default
    every other store  the app_config defaults, 10 / 5 / 15

  READ THE TOTALS BELOW AS GROSS INTAKE, NOT AS THE RECEIPT TOTAL.
  Since D27 and D28 the printed receipt will NOT equal these figures, and that is
  correct rather than a defect. Two things move it, in this order:
    1. D27 shifts weight out of bakery, produce and deli into a computed Trash line.
       It never changes the total, because Trash is itself reported: the check is
       net + trash == gross, per receipt.
    2. D28 then rounds every line to whole pounds, and the receipt total is the sum
       of the ROUNDED lines. That is the only thing that may move the total, and only
       ever by a pound or two per receipt.
  So S3.2 (which reports gross, deliberately) should match these exactly, while the
  receipts may sit slightly above or below. A receipt total that differs by more than
  the rounding, or a per-receipt net + trash that does not equal gross, is a real bug.

  THE NUMBERS TO CHECK EVERYTHING ELSE AGAINST
  S3.2 (Admin metrics) reports GROSS and must match these EXACTLY.
  S3.1 and the receipts are whole pounds (D28), so they sit a little above or below.
  For the closed week that is 446 against 445.75, and the quarter-pound is the whole
  of the difference. Anything larger is a real bug.
  Three sources agreeing is evidence; one reporting success is not.

    closed week ${prevMonday}
      reported    ${total(closedReported)} lb     weights only, no walk-ins
      intake      ${total(closed)} lb
      unreported  ${(Number(total(closed)) - Number(total(closedReported))).toFixed(2)} lb

    current week ${thisMonday}   (incomplete: runs still open)
      reported    ${total(currentReported)} lb     weights + the reportable walk-in
      intake      ${total(current)} lb
      unreported  ${(Number(total(current)) - Number(total(currentReported))).toFixed(2)} lb

  Lane B fixtures (do not touch from a browser)
    double-claim run   ${raceClaim}
    same-stop weights  ${raceWeigh}
    reassign source    ${raceMoveFrom}
    reassign target    ${raceMoveTo}

  receiver_edit_window_days restored to ${windowWas}. The closed week's window is now
  shut, which is the state D9 needs: the receiver is refused, the Reporter is not.

  ntfb_category ships SEEDED since D26 — 10 categories, all 11 of ours mapped, storage
  set, and the AGFP Trash category archived because D27 computes it. So the export works
  on a fresh database, which it never did before. To exercise the refusal instead, clear
  one mapping that carries weight under Admin, Category matching.
`);
}

main()
  .then(() => db.destroy())
  .catch(async (error) => {
    console.error(error);
    await db.destroy();
    process.exit(1);
  });
