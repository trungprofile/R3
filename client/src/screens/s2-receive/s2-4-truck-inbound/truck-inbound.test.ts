// S2.4 truck-inbound alert — the rules this banner repeats, tested.
//
// NOTHING HERE RENDERS. There is no browser or component harness in this repo and
// adding one would be a dependency a lane may not add (build-plan §3/D5), so the
// banner's decisions were written as functions of plain records precisely so they
// could be tested at all. What is NOT covered is stated in the wave report rather
// than implied by a green suite.
//
// The two that matter most are the two a wrong answer would break silently:
//
//   the message contract  `parseTruckInboundMessage` is the exact shape the
//                         service worker must post. It is not exercised end to
//                         end anywhere, because the delivery half lives in files
//                         this lane does not own.
//   the sound             a chime that cannot play must be a quieter alert, never
//                         a broken one. Under Node there is no AudioContext at
//                         all, which is the same code path as a blocked one.
//
// Run: npx vitest run --root client

import { afterEach, describe, expect, it } from 'vitest';
import {
  EMPTY_TRUCK_INBOUND_STATE,
  FORBIDDEN_IN_COPY,
  MAX_QUEUED_ALERTS,
  TRUCK_INBOUND_COPY,
  TRUCK_INBOUND_EVENT,
  TRUCK_INBOUND_MESSAGE_TYPE,
  armTruckInboundSound,
  currentTruckInbound,
  dismissTruckInbound,
  parseTruckInboundMessage,
  playTruckInboundChime,
  possessive,
  queuedLabel,
  queuedTruckInbound,
  receiveTruckInbound,
  resetTruckInboundSound,
  truckInboundBody,
  truckInboundDetail,
} from './truck-inbound.ts';
import type { TruckInboundAlert, TruckInboundState } from './truck-inbound.ts';

afterEach(() => {
  resetTruckInboundSound();
});

function alert(over: Partial<TruckInboundAlert> = {}): TruckInboundAlert {
  return {
    id: 'notif-1',
    route: 'Tuesday North',
    who: 'Sam',
    when: 'Tue Aug 4, 2:00 PM',
    ...over,
  };
}

/** The message shape `sw.ts` has to post. Written out in full here on purpose:
 *  this object IS the contract the wave report asks the lead to implement. */
function message(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: TRUCK_INBOUND_MESSAGE_TYPE,
    event: TRUCK_INBOUND_EVENT,
    notificationId: 'notif-1',
    route: 'Tuesday North',
    who: 'Sam',
    when: 'Tue Aug 4, 2:00 PM',
    ...over,
  };
}

// ---------------------------------------------------------------------------
// The message contract
// ---------------------------------------------------------------------------

describe('reading an alert off the worker channel', () => {
  it('reads the three facts the server sends', () => {
    // `completePickup` enqueues `{ route, who, when }` — `when` already formatted
    // in the pantry's zone, because only the enqueuing service has that context.
    expect(parseTruckInboundMessage(message())).toEqual({
      id: 'notif-1',
      route: 'Tuesday North',
      who: 'Sam',
      when: 'Tue Aug 4, 2:00 PM',
    });
  });

  it('ignores the navigate message already on this channel', () => {
    // `sw.ts` posts `{ type: 'navigate', url }` when someone taps a banner. Both
    // messages share one `serviceWorker` message listener, so each has to ignore
    // the other rather than assume it is alone.
    expect(parseTruckInboundMessage({ type: 'navigate', url: '/shifts/abc' })).toBeNull();
  });

  it('ignores an alert for any other event', () => {
    // Only truck-inbound is device-scoped; every other event goes to a person and
    // belongs in the inbox, not in a banner over someone weighing.
    expect(parseTruckInboundMessage(message({ event: 'SHIFT_REMINDER' }))).toBeNull();
  });

  it('refuses a message with no id', () => {
    // Without the server's row id there is nothing to dedupe an at-least-once
    // repeat against, and nothing to dismiss.
    expect(parseTruckInboundMessage(message({ notificationId: '' }))).toBeNull();
    expect(parseTruckInboundMessage(message({ notificationId: undefined }))).toBeNull();
  });

  it('survives junk without throwing', () => {
    for (const junk of [null, undefined, 7, 'alert', [], {}]) {
      expect(parseTruckInboundMessage(junk)).toBeNull();
    }
  });

  it('accepts an alert carrying nothing but its id', () => {
    // The banner exists to get someone to the dock; a bare one still does that.
    expect(
      parseTruckInboundMessage({
        type: TRUCK_INBOUND_MESSAGE_TYPE,
        event: TRUCK_INBOUND_EVENT,
        notificationId: 'notif-9',
      }),
    ).toEqual({ id: 'notif-9', route: null, who: null, when: null });
  });
});

// ---------------------------------------------------------------------------
// What it says
// ---------------------------------------------------------------------------

describe('the headline', () => {
  it('reads the way S2.4 writes it', () => {
    // "Truck inbound — Sam's run returning".
    expect(TRUCK_INBOUND_COPY.title).toBe('Truck inbound');
    expect(truckInboundBody(alert())).toBe("Sam's run returning");
  });

  it('makes a possessive that reads aloud', () => {
    expect(possessive('Sam')).toBe("Sam's");
    expect(possessive('Karen')).toBe("Karen's");
    expect(possessive('Chris')).toBe("Chris'");
  });

  it('falls back to the route, then to something still true', () => {
    expect(truckInboundBody(alert({ who: null }))).toBe('Tuesday North returning');
    expect(truckInboundBody(alert({ who: null, route: null }))).toBe(
      TRUCK_INBOUND_COPY.fallbackBody,
    );
    // Whitespace is not a name.
    expect(truckInboundBody(alert({ who: '  ', route: '  ' }))).toBe(
      TRUCK_INBOUND_COPY.fallbackBody,
    );
  });

  it('puts whatever the headline did not use on the second line', () => {
    expect(truckInboundDetail(alert())).toBe('Tuesday North · Tue Aug 4, 2:00 PM');
    // The route led the headline, so it is not repeated underneath.
    expect(truckInboundDetail(alert({ who: null }))).toBe('Tue Aug 4, 2:00 PM');
    expect(truckInboundDetail(alert({ who: null, when: null }))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Which alert is showing
// ---------------------------------------------------------------------------

describe('the queue', () => {
  const queue = (...alerts: TruckInboundAlert[]): TruckInboundState =>
    alerts.reduce<TruckInboundState>(
      (state, next) => receiveTruckInbound(state, next),
      EMPTY_TRUCK_INBOUND_STATE,
    );

  it('shows nothing until one arrives', () => {
    expect(currentTruckInbound(EMPTY_TRUCK_INBOUND_STATE)).toBeNull();
    expect(queuedTruckInbound(EMPTY_TRUCK_INBOUND_STATE)).toBe(0);
  });

  it('collapses an at-least-once repeat into one banner', () => {
    // The server's dispatch is at-least-once by design (`architecture.md §4.4`)
    // and `sw.ts` already dedupes the operating system's banner by the same id.
    const state = queue(alert(), alert());
    expect(state.queue).toHaveLength(1);
  });

  it('keeps a second truck behind the first rather than replacing it', () => {
    const state = queue(alert(), alert({ id: 'notif-2', who: 'Miguel' }));
    expect(currentTruckInbound(state)?.id).toBe('notif-1');
    expect(queuedTruckInbound(state)).toBe(1);
    expect(queuedLabel(1)).toBe('1 more truck inbound');
    expect(queuedLabel(2)).toBe('2 more trucks inbound');
    expect(queuedLabel(0)).toBeNull();
  });

  it('drops the oldest once the queue is full', () => {
    // A dock nobody touched for an hour must not become a stack to tap through.
    const many = Array.from({ length: MAX_QUEUED_ALERTS + 2 }, (_, index) =>
      alert({ id: `notif-${index}` }),
    );
    const state = queue(...many);
    expect(state.queue).toHaveLength(MAX_QUEUED_ALERTS);
    expect(currentTruckInbound(state)?.id).toBe('notif-2');
  });

  it('dismisses by id, so a late arrival is not cleared with it', () => {
    const state = queue(alert(), alert({ id: 'notif-2' }));
    const after = dismissTruckInbound(state, 'notif-1');
    expect(currentTruckInbound(after)?.id).toBe('notif-2');
  });

  it('does not resurrect one already dismissed', () => {
    // The same alert can be redelivered after the receiver waved it away.
    const after = receiveTruckInbound(EMPTY_TRUCK_INBOUND_STATE, alert(), ['notif-1']);
    expect(currentTruckInbound(after)).toBeNull();
  });

  it('needs no login anywhere in this file', () => {
    // S2.4: "Does not require login to show." Nothing here reads a signed-in user,
    // and the server addresses the alert to the device rather than to a person
    // (`recipient_id` null), which is what makes that possible.
    const state = queue(alert());
    expect(currentTruckInbound(state)).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The sound
// ---------------------------------------------------------------------------

describe('the chime', () => {
  it('reports rather than throws when there is no audio at all', async () => {
    // Node has no AudioContext. Same code path as a browser that has one but is
    // holding it: the banner is the signal, the chime is only the nudge.
    await expect(playTruckInboundChime()).resolves.toBe('unsupported');
  });

  it('reports "blocked" when the browser is holding audio for a gesture', async () => {
    // Every browser that matters refuses to start audio until the document has
    // been interacted with — and a device-scoped alert can land on a tablet
    // nobody has touched. `blocked` is an expected outcome, not an error.
    const context = {
      state: 'suspended',
      resume: () => Promise.resolve(),
    };
    const scope = globalThis as unknown as { AudioContext?: unknown };
    scope.AudioContext = function AudioContextStub(this: unknown) {
      return context;
    } as unknown;
    try {
      await expect(playTruckInboundChime()).resolves.toBe('blocked');
    } finally {
      delete scope.AudioContext;
    }
  });

  it('arming it is safe with no audio and never throws', async () => {
    await expect(armTruckInboundSound()).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Copy (§7)
// ---------------------------------------------------------------------------

describe('microcopy', () => {
  /**
   * Every sentence this banner can put on screen — not just the fixed ones.
   *
   * `truckInboundBody` and `truckInboundDetail` COMPOSE their text from server
   * facts, so sweeping only `TRUCK_INBOUND_COPY` would leave the banner's most
   * visible line ("Karen's run returning") outside the §7 check that every sibling
   * screen applies to its whole copy surface. All three composition branches are
   * covered: driver known, route only, and the bare fallback.
   */
  const composed = [
    truckInboundBody({ id: 'a', who: 'Karen', route: 'Tuesday North', when: 'Tue 2:00 PM' }),
    truckInboundBody({ id: 'b', who: null, route: 'Tuesday North', when: null }),
    truckInboundBody({ id: 'c', who: null, route: null, when: null }),
    truckInboundDetail({ id: 'd', who: 'Karen', route: 'Tuesday North', when: 'Tue 2:00 PM' }),
  ].filter((line): line is string => line !== null);

  const sentences = [
    ...Object.values(TRUCK_INBOUND_COPY),
    queuedLabel(1)!,
    queuedLabel(2)!,
    ...composed,
  ];

  it('says something everywhere', () => {
    for (const sentence of sentences) expect(sentence.length).toBeGreaterThan(0);
  });

  it('uses no forbidden word', () => {
    // §7 forbids the whole vocabulary this banner is built out of. The word for
    // the subsystem in the UI is "alerts", and this screen does not need even
    // that — it talks about a truck.
    for (const sentence of sentences) {
      for (const word of FORBIDDEN_IN_COPY) {
        expect(sentence.toLowerCase()).not.toContain(word);
      }
    }
  });

  it('says a truck is coming, never that a run is finished', () => {
    // "Heading back" is a milestone inside IN_PROGRESS (I27). Only the receiver's
    // receive-done completes a run (I11, D7) and that is S2.2b, not this banner.
    for (const sentence of sentences) {
      expect(sentence).not.toMatch(/\b(complete|completed|finished|done with)\b/i);
    }
    expect(truckInboundBody(alert())).not.toMatch(/finished|complete/i);
  });

  it('asks for nothing but a dismissal', () => {
    // Someone mid-weighing has to clear it and carry on without wondering what
    // they just agreed to.
    expect(TRUCK_INBOUND_COPY.dismiss).not.toMatch(/\?|confirm|accept|ok to/i);
  });
});
