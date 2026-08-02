// What S1.5 sends, and what it does not.
//
// The requests are stubbed at `fetch` — the point is not that the network works
// but that this screen speaks the endpoints the execution lane built, and that
// nothing in this folder ever tries to change a shift's state. The real contract
// is proved server-side against the migrated database
// (`server/test/execution.test.ts`); this pins the browser half of it.
//
// Run: npx vitest run --root client

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DRIVER_RESOLUTIONS } from '../../../api/shared.ts';
import * as pickupApi from './api.ts';

interface Call {
  method: string;
  url: string;
  body: Record<string, unknown> | null;
}

const originalFetch = globalThis.fetch;
let calls: Call[] = [];

beforeEach(() => {
  calls = [];
  globalThis.fetch = ((input: unknown, init: RequestInit = {}) => {
    const raw = init.body;
    calls.push({
      method: init.method ?? 'GET',
      url: String(input),
      body: typeof raw === 'string' ? (JSON.parse(raw) as Record<string, unknown>) : null,
    });
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    } as unknown as Response);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function only(): Call {
  expect(calls).toHaveLength(1);
  return calls[0]!;
}

// ---------------------------------------------------------------------------

describe('reading the run', () => {
  it('asks for the run, its stops and their dispositions', async () => {
    await pickupApi.fetchRun('shift-1', new AbortController().signal);
    const call = only();
    expect(call.method).toBe('GET');
    expect(call.url).toBe('/api/shifts/shift-1/run');
  });

  it('escapes an id rather than pasting it into a path', async () => {
    await pickupApi.fetchRun('a/b?c', new AbortController().signal);
    expect(only().url).toBe('/api/shifts/a%2Fb%3Fc/run');
  });

  it('asks for the active trucks only', async () => {
    await pickupApi.fetchTrucks(new AbortController().signal);
    const call = only();
    expect(call.method).toBe('GET');
    // No `includeInactive`: an inactive truck is hidden from driver selection
    // (`domain-modeling.md §3.3`), and the server's default is the active set.
    expect(call.url).toBe('/api/trucks');
  });
});

describe('starting the run', () => {
  it('sends the truck and nothing else', async () => {
    // The route is already bound and the driver comes from the sign-in, so a
    // truck is all that is left to choose. The I5 snapshot happens server-side.
    await pickupApi.startRun('shift-1', 'truck-9');
    const call = only();
    expect(call.method).toBe('POST');
    expect(call.url).toBe('/api/shifts/shift-1/start');
    expect(call.body).toEqual({ truckId: 'truck-9' });
  });
});

describe('resolving a stop', () => {
  it('sends one of the two dispositions a driver may set', async () => {
    await pickupApi.resolveStop('shift-1', 'stop-2', 'COLLECTED');
    const call = only();
    expect(call.method).toBe('POST');
    expect(call.url).toBe('/api/shifts/shift-1/stops/stop-2/resolve');
    expect(call.body).toEqual({ disposition: 'COLLECTED' });
  });

  it('sends SKIPPED the same way', async () => {
    await pickupApi.resolveStop('shift-1', 'stop-2', 'SKIPPED');
    expect(only().body).toEqual({ disposition: 'SKIPPED' });
  });

  it('sends only the two dispositions the shared type allows', () => {
    // `DriverResolution` is exactly {COLLECTED, SKIPPED}: PENDING is the system's
    // (I5), REASSIGNED is staff-only (I30), WEIGHED is derived and never written
    // (I12). There is no un-check to send either — the machine has no edge back
    // to PENDING (A83) — so the call takes no disposition beyond those two.
    expect([...DRIVER_RESOLUTIONS]).toEqual(['COLLECTED', 'SKIPPED']);
  });

  it('writes the stop note on its own request', async () => {
    await pickupApi.saveStopNote('shift-1', 'stop-2', 'two crates of bread');
    const call = only();
    expect(call.method).toBe('PATCH');
    expect(call.url).toBe('/api/shifts/shift-1/stops/stop-2');
    expect(call.body).toEqual({ note: 'two crates of bread' });
  });

  it('clears a note with null rather than an empty string', async () => {
    await pickupApi.saveStopNote('shift-1', 'stop-2', null);
    expect(only().body).toEqual({ note: null });
  });
});

describe('reordering', () => {
  it('sends the order as a list of stop ids', async () => {
    await pickupApi.saveOrder('shift-1', ['stop-3', 'stop-1']);
    const call = only();
    expect(call.method).toBe('POST');
    expect(call.url).toBe('/api/shifts/shift-1/stops/order');
    expect(call.body).toEqual({ stopIds: ['stop-3', 'stop-1'] });
  });
});

describe('heading back (I27)', () => {
  it('posts the milestone with the run note alongside it', async () => {
    await pickupApi.confirmHeadingBack('shift-1', 'gate was locked at Aldi');
    const call = only();
    expect(call.method).toBe('POST');
    expect(call.url).toBe('/api/shifts/shift-1/pickup-complete');
    expect(call.body).toEqual({ note: 'gate was locked at Aldi' });
  });

  it('writes the run note on its own once the milestone is set', async () => {
    await pickupApi.saveRunNote('shift-1', null);
    const call = only();
    expect(call.method).toBe('PATCH');
    expect(call.url).toBe('/api/shifts/shift-1/note');
    expect(call.body).toEqual({ note: null });
  });
});

describe('flagging a stop not on my route (cap 12)', () => {
  it('asks for the stores and the kinds of food, active sets only', async () => {
    await pickupApi.fetchDonors(new AbortController().signal);
    expect(only().url).toBe('/api/donors');

    calls = [];
    await pickupApi.fetchCategories(new AbortController().signal);
    expect(only().url).toBe('/api/categories');
    // No `includeInactive` on either: I21 keeps a deactivated master resolvable in
    // history but out of new work, and the server's default is the active set.
  });

  it('posts the flag under the run, so the row carries the shift (D10)', async () => {
    await pickupApi.flagAdHocPickup('shift-1', { donorId: 'donor-7', categoryId: 'cat-2' });
    const call = only();
    expect(call.method).toBe('POST');
    // D10: `POST /shifts/:id/donations` always sets `shift_id`; the receiver's
    // `POST /donations` never does. The path is what makes that structural.
    expect(call.url).toBe('/api/shifts/shift-1/donations');
    expect(call.body).toEqual({ donorId: 'donor-7', categoryId: 'cat-2' });
  });

  it('sends a category every time — D8, even though S1.5 says "just a donor"', async () => {
    // `domain-modeling.md §2.3` (locked) has no SUGGESTED exemption for Category
    // and `data-model.md §7.2` stores it NOT NULL, so a row without one cannot be
    // written at all. The locked doc beats `ui-ux-spec.md:193`.
    await pickupApi.flagAdHocPickup('shift-1', { categoryId: 'cat-2' });
    await pickupApi.flagAdHocPickup('shift-1', { donorLabel: 'The bakery on 5th', categoryId: 'c' });
    for (const call of calls) {
      expect(Object.keys(call.body ?? {})).toContain('categoryId');
    }
  });

  it('never sends a weight — the driver has no scale', async () => {
    await pickupApi.flagAdHocPickup('shift-1', {
      donorLabel: 'The bakery on 5th',
      categoryId: 'cat-2',
      note: 'two trays',
    });
    const keys = Object.keys(only().body ?? {});
    expect(keys).not.toContain('weight');
    // Nor a reportable flag: I15 defaults it ON server-side, and the receiver owns
    // the toggle at S2.3.
    expect(keys).not.toContain('reportable');
  });

  it('escapes the shift id rather than pasting it into a path', async () => {
    await pickupApi.flagAdHocPickup('a/b', { categoryId: 'cat-2' });
    expect(only().url).toBe('/api/shifts/a%2Fb/donations');
  });
});

describe('D1/I14 — nothing here closes a run, and nothing here writes a stop', () => {
  it('exports no call that completes, closes or finishes a shift', async () => {
    // I11 makes the receiver's receive-done the only completion action, and D7
    // keeps it to exactly one place — `receiveDone()`, which is not in this folder.
    for (const name of Object.keys(pickupApi)) {
      expect(name).not.toMatch(/complete(?!Pickup)|finish|close|receive/i);
    }
    expect(Object.keys(pickupApi).sort()).toEqual([
      'confirmHeadingBack',
      'fetchCategories',
      // D20 — the donor list again, for the map link and the photo flag. A read,
      // like every other `fetch*` here.
      'fetchDonorPlaces',
      'fetchDonors',
      'fetchRun',
      'fetchTrucks',
      'flagAdHocPickup',
      'resolveStop',
      'saveOrder',
      'saveRunNote',
      'saveStopNote',
      'startRun',
    ]);
  });

  it('never puts a shift status on the wire', async () => {
    await pickupApi.startRun('shift-1', 'truck-9');
    await pickupApi.resolveStop('shift-1', 'stop-2', 'COLLECTED');
    await pickupApi.saveStopNote('shift-1', 'stop-2', 'x');
    await pickupApi.saveOrder('shift-1', ['stop-2']);
    await pickupApi.saveRunNote('shift-1', 'x');
    await pickupApi.confirmHeadingBack('shift-1', 'x');
    await pickupApi.flagAdHocPickup('shift-1', { categoryId: 'cat-2' });

    expect(calls).toHaveLength(7);
    for (const call of calls) {
      const keys = Object.keys(call.body ?? {});
      // `disposition` is a ShiftStop's, not the shift's. Nothing this screen
      // sends can move `Shift.status` or set the milestone by hand.
      expect(keys).not.toContain('status');
      expect(keys).not.toContain('pickupCompletedAt');
      // I14: a driver-add never creates a ShiftStop. There is no stop-shaped field
      // to send on the flag, and no endpoint in this folder that would take one.
      expect(keys).not.toContain('stopId');
      expect(keys).not.toContain('position');
    }
  });
});
