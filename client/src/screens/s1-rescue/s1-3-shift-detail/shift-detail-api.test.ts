// What S1.3 sends, and what it does not.
//
// The requests are stubbed at `fetch` — the point is not that the network works but
// that this screen speaks the endpoints Waves 1–3 built, and that nothing in this
// folder reaches for one that is not S1.3's. The real contract is proved server-side
// against the migrated database (`server/test/coverage.test.ts`,
// `server/test/execution.test.ts`); this pins the browser half.
//
// Run: npx vitest run --root client

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as detailApi from './api.ts';

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

const signal = () => new AbortController().signal;

// ---------------------------------------------------------------------------

describe('reading the run', () => {
  it('asks for the shift and its planned route', async () => {
    await detailApi.fetchShift('shift-1', signal());
    const call = only();
    expect(call.method).toBe('GET');
    expect(call.url).toBe('/api/shifts/shift-1');
  });

  it('asks for the live stop list separately — I5 gives a run rows only at start', async () => {
    await detailApi.fetchRun('shift-1', signal());
    expect(only().url).toBe('/api/shifts/shift-1/run');
  });

  it('escapes an id rather than pasting it into a path', async () => {
    await detailApi.fetchShift('a/b?c', signal());
    expect(only().url).toBe('/api/shifts/a%2Fb%3Fc');
  });
});

describe('the coordinator note', () => {
  it('is written through the shift, not through the driver note route', async () => {
    // `PATCH /shifts/:id/note` is the DRIVER's whole-run note and is declared
    // `anyDuty: ['DRIVE']`. The coordinator→driver note is `staffNote` on the
    // shift, declared `tier: 'STAFF'` — two fields, two writers.
    await detailApi.saveStaffNote('shift-1', 'Ring the bell at the back.');
    const call = only();
    expect(call.method).toBe('PATCH');
    expect(call.url).toBe('/api/shifts/shift-1');
    expect(call.body).toEqual({ staffNote: 'Ring the bell at the back.' });
  });

  it('sends null to clear it, because absent means "leave it alone"', async () => {
    await detailApi.saveStaffNote('shift-1', null);
    expect(only().body).toEqual({ staffNote: null });
  });
});

describe('release', () => {
  it('releases just this one by naming the scope', async () => {
    await detailApi.releaseRun('shift-1', { scope: 'ONE' });
    const call = only();
    expect(call.method).toBe('POST');
    expect(call.url).toBe('/api/shifts/shift-1/release');
    expect(call.body).toEqual({ scope: 'ONE' });
  });

  it('sends no end date for "this and future"', async () => {
    // An omitted `toDate` is the open-ended half of the range; `fromDate` defaults
    // to this run's own day server-side.
    await detailApi.releaseRun('shift-1', { scope: 'RANGE' });
    expect(only().body).toEqual({ scope: 'RANGE' });
  });

  it('bounds the range when a day was chosen', async () => {
    await detailApi.releaseRun('shift-1', { scope: 'RANGE', toDate: '2026-08-18' });
    expect(only().body).toEqual({ scope: 'RANGE', toDate: '2026-08-18' });
  });
});

describe('reassign', () => {
  it('names the destination run and nothing else', async () => {
    await detailApi.reassignStop('shift-1', 'stop-7', 'shift-2');
    const call = only();
    expect(call.method).toBe('POST');
    expect(call.url).toBe('/api/shifts/shift-1/stops/stop-7/reassign');
    // No disposition: the source stop becoming `REASSIGNED` and the new `PENDING`
    // row on the destination are both the server's, in one transaction (I30).
    expect(call.body).toEqual({ toShiftId: 'shift-2' });
  });

  it('asks for one day of runs to build the driver picker', async () => {
    await detailApi.fetchShiftsOn('2026-08-04', signal());
    expect(only().url).toBe('/api/shifts?from=2026-08-04&to=2026-08-04');
  });
});

describe('the release range days', () => {
  it('asks for this driver own runs in the series, from this run forward', async () => {
    await detailApi.fetchSeriesRuns('pattern-1', '2026-08-04', signal());
    expect(only().url).toBe('/api/shifts?patternId=pattern-1&from=2026-08-04&mine=true');
  });
});

describe('what this screen never sends', () => {
  it('has no call that closes, completes or finishes a run', () => {
    // I11 makes the receiver's receive-done the only completion action and it ships
    // in Phase 2 (build-plan D1). A "close run" button here would be a second
    // completion path Phase 2 would have to remove again.
    const names = Object.keys(detailApi).join(' ').toLowerCase();
    expect(names).not.toContain('complete');
    expect(names).not.toContain('close');
    expect(names).not.toContain('finish');
  });

  it('has no call that terminates a repeating run', () => {
    // Staff's bulk-terminate is `POST /patterns/:id/terminate` and belongs to S1.6.
    // S1.3's release returns runs to the board; the series keeps generating (I23).
    const names = Object.keys(detailApi).join(' ').toLowerCase();
    expect(names).not.toContain('terminate');
    expect(names).not.toContain('cancel');
    expect(names).not.toContain('pattern');
  });

  it('has no call that resolves, skips or reorders a stop', () => {
    // Those are the driver's, on S1.5. The one write S1.3 puts on a stop is I30's
    // staff-only reassign.
    const names = Object.keys(detailApi).join(' ').toLowerCase();
    expect(names).not.toContain('resolve');
    expect(names).not.toContain('skip');
    expect(names).not.toContain('order');
    expect(names).not.toContain('start');
  });
});
