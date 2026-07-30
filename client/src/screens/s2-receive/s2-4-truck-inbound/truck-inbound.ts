// S2.4 truck-inbound alert — every decision the banner makes, as plain functions.
//
// `ui-ux-spec.md S2.4`, in full: "full-width banner at top + sound, 'Truck inbound
// — Sam's run returning'. Dismiss is large. Does not require login to show. If
// someone is mid-weighing, it banners above without stealing the keypad."
//
// Written as functions of plain records for the same reason S1.5's logic is: there
// is no browser or component harness in this repo and adding one would be a
// dependency (build-plan §3/D5).
//
// ---------------------------------------------------------------------------
// WHERE THE FACTS COME FROM, AND WHAT THIS HALF DOES NOT DO
// ---------------------------------------------------------------------------
//
// `services/execution.ts` `completePickup()` enqueues one `TRUCK_INBOUND` row per
// live device registration, with `recipient_id` null — addressed to the dock, not
// to a person, which is exactly what makes it show with nobody logged in (PRD §2).
// Its stored facts are `{ route, who, when }`, and `when` is already formatted in
// the pantry's zone by the enqueuing service.
//
// Getting those facts from the worker into an OPEN page is the delivery half, and
// it lives in `client/src/sw.ts` and `client/src/pwa/` — files this lane does not
// own. `parseTruckInboundMessage` below is the exact contract that half must meet;
// the wave report states the change the lead adds. Until it is added, nothing
// calls this module and no banner appears — the tablet still gets the operating
// system's own notification banner from `sw.ts`, which is the existing behaviour.
//
// The word for this subsystem in the UI is "alerts" (§7). Nothing here says push,
// subscription, endpoint or payload.

// ---------------------------------------------------------------------------
// The alert
// ---------------------------------------------------------------------------

/**
 * One truck on its way back.
 *
 * `id` is the server's notification row id — the same value `sw.ts` already uses
 * as the banner `tag`. Delivery is at-least-once (`architecture.md §4.4`), so the
 * id is what collapses a repeat into one banner instead of two.
 */
export interface TruckInboundAlert {
  id: string;
  /** Route name, e.g. "Tuesday North". */
  route: string | null;
  /** The driver heading back. */
  who: string | null;
  /** Pre-formatted local time — the enqueuing service is the only place with the
   *  pantry's zone, so the wire carries the words, not a timestamp. */
  when: string | null;
}

/** The message `sw.ts` must post to an open page. Deliberately distinct from the
 *  existing `{ type: 'navigate', url }`, which means "the user tapped a banner". */
export const TRUCK_INBOUND_MESSAGE_TYPE = 'alert';

/** The server's event string (`services/notification.ts`). */
export const TRUCK_INBOUND_EVENT = 'TRUCK_INBOUND';

function clean(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Read one worker message. Returns null for anything that is not a truck-inbound
 * alert — including the navigate messages already flowing down this channel.
 *
 * Everything except the id is optional, because the banner exists to get someone
 * to the dock and a bare alert still does that. A message with no id is refused:
 * without it there is nothing to dedupe on and nothing to dismiss.
 */
export function parseTruckInboundMessage(data: unknown): TruckInboundAlert | null {
  if (typeof data !== 'object' || data === null) return null;
  const message = data as Record<string, unknown>;

  if (message['type'] !== TRUCK_INBOUND_MESSAGE_TYPE) return null;
  if (message['event'] !== TRUCK_INBOUND_EVENT) return null;

  const id = clean(message['notificationId']);
  if (id === null) return null;

  return {
    id,
    route: clean(message['route']),
    who: clean(message['who']),
    when: clean(message['when']),
  };
}

// ---------------------------------------------------------------------------
// What the banner says
// ---------------------------------------------------------------------------

/** "Sam" → "Sam's"; "Chris" → "Chris'". Plain possessive, so the headline reads
 *  like the spec's example rather than like a template. */
export function possessive(name: string): string {
  return /s$/i.test(name) ? `${name}'` : `${name}'s`;
}

/**
 * The headline under the title — S2.4's "Sam's run returning".
 *
 * The driver's name leads because that is what a receiver recognises from the run
 * picker (S2.1b lists runs as "Karen's Tue AM run"). Route is the fallback, and a
 * bare alert still says something true.
 */
export function truckInboundBody(alert: TruckInboundAlert): string {
  const who = clean(alert.who);
  if (who !== null) return `${possessive(who)} run returning`;

  const route = clean(alert.route);
  if (route !== null) return `${route} returning`;

  return TRUCK_INBOUND_COPY.fallbackBody;
}

/** The quieter second line: whatever the headline did not already use. */
export function truckInboundDetail(alert: TruckInboundAlert): string | null {
  const usedWho = clean(alert.who) !== null;
  const parts = [usedWho ? clean(alert.route) : null, clean(alert.when)].filter(
    (part): part is string => part !== null,
  );
  return parts.length === 0 ? null : parts.join(' · ');
}

// ---------------------------------------------------------------------------
// Which alert is showing (dismissal state)
// ---------------------------------------------------------------------------

/**
 * Two trucks can be heading back at once — the pantry runs several routes a day
 * and `completePickup` fans out per device, not per run. So this is a queue, and
 * dismissing shows the next rather than swallowing it.
 */
export interface TruckInboundState {
  queue: readonly TruckInboundAlert[];
}

export const EMPTY_TRUCK_INBOUND_STATE: TruckInboundState = { queue: [] };

/**
 * How many wait behind the one on screen.
 *
 * A dock nobody dismissed for an hour must not become a stack of banners to tap
 * through, so the oldest is dropped once the queue is full: the truck pulling in
 * now matters more than the one that arrived twenty minutes ago.
 */
export const MAX_QUEUED_ALERTS = 3;

/** Deduped by id, because delivery is at-least-once and the same alert can arrive
 *  twice (`architecture.md §4.4`). A repeat does not re-queue and does not
 *  resurrect one already dismissed in this page's lifetime. */
export function receiveTruckInbound(
  state: TruckInboundState,
  alert: TruckInboundAlert,
  dismissedIds: readonly string[] = [],
): TruckInboundState {
  if (dismissedIds.includes(alert.id)) return state;
  if (state.queue.some((queued) => queued.id === alert.id)) return state;

  const queue = [...state.queue, alert];
  return { queue: queue.slice(Math.max(0, queue.length - MAX_QUEUED_ALERTS)) };
}

/** The large Dismiss. Drops that alert wherever it sits, so dismissing the one on
 *  screen cannot accidentally clear a later one. */
export function dismissTruckInbound(state: TruckInboundState, id: string): TruckInboundState {
  return { queue: state.queue.filter((alert) => alert.id !== id) };
}

/** The one on screen, or null for no banner at all. */
export function currentTruckInbound(state: TruckInboundState): TruckInboundAlert | null {
  return state.queue[0] ?? null;
}

/** How many are still behind it. */
export function queuedTruckInbound(state: TruckInboundState): number {
  return Math.max(0, state.queue.length - 1);
}

/** The "and there are more" line. Absent at zero — a banner that says "0 more" is
 *  noise on a screen someone is trying to weigh on. */
export function queuedLabel(count: number): string | null {
  if (count <= 0) return null;
  return count === 1 ? '1 more truck inbound' : `${count} more trucks inbound`;
}

// ---------------------------------------------------------------------------
// The sound
// ---------------------------------------------------------------------------

/**
 * Whether the chime actually made a noise.
 *
 * `blocked` is the normal, expected outcome and is NOT an error: every browser
 * that matters refuses to start audio until the document has been interacted
 * with, and a device-scoped alert can land on a tablet nobody has touched since
 * it was unlocked. See `armTruckInboundSound` and the wave report.
 */
export type ChimeOutcome = 'played' | 'blocked' | 'unsupported';

type AudioContextCtor = new () => AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  const scope = globalThis as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

let context: AudioContext | null = null;

function openContext(): AudioContext | null {
  const Ctor = audioContextCtor();
  if (Ctor === null) return null;
  try {
    context ??= new Ctor();
    return context;
  } catch {
    return null;
  }
}

/**
 * Give the browser its user gesture, so a later unprompted chime is allowed.
 *
 * An `AudioContext` created outside a gesture starts `suspended` and stays there
 * until one arrives. Calling this from the first tap anywhere on the tablet —
 * signing in, tapping a category — leaves it `running`, and the alert that lands
 * an hour later can then be heard. Safe to call as often as you like.
 */
export async function armTruckInboundSound(): Promise<void> {
  const open = openContext();
  if (open === null) return;
  try {
    if (open.state === 'suspended') await open.resume();
  } catch {
    // Nothing to say and nothing to do: the banner is still on screen, and §5's
    // rule that the app works with alerts off applies here too.
  }
}

/**
 * Two short notes, synthesized — no audio asset, because a lane may add no
 * dependency and a data-URI sound file is a binary blob nobody can review.
 *
 * NEVER THROWS and never shows anything. A sound that cannot play is a quieter
 * alert, not a broken one: the banner is the signal, the chime is the nudge.
 */
export async function playTruckInboundChime(): Promise<ChimeOutcome> {
  const open = openContext();
  if (open === null) return 'unsupported';

  try {
    if (open.state === 'suspended') {
      await open.resume();
      // Still held: the browser is waiting for a user gesture this page has not
      // had. Expected on a tablet sitting untouched at the dock.
      if (open.state === 'suspended') return 'blocked';
    }

    const start = open.currentTime;
    for (const [index, frequency] of [740, 988].entries()) {
      const at = start + index * 0.18;
      const oscillator = open.createOscillator();
      const gain = open.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      // Shaped rather than square-edged: an abrupt start clicks, and this plays in
      // a room where people are working.
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.2, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
      oscillator.connect(gain);
      gain.connect(open.destination);
      oscillator.start(at);
      oscillator.stop(at + 0.18);
    }
    return 'played';
  } catch {
    return 'blocked';
  }
}

/** Test seam. A new page load starts a new audio context. */
export function resetTruckInboundSound(): void {
  context = null;
}

// ---------------------------------------------------------------------------
// Copy (§7: plain, short, second person; no jargon)
// ---------------------------------------------------------------------------

/** Forbidden in any UI string (`ui-ux-spec.md §7`). Pinned by a test rather than
 *  by good intentions — and this screen is the one most tempted by them, since it
 *  is the visible end of the alert machinery. */
export const FORBIDDEN_IN_COPY = [
  'pwa',
  'push subscription',
  'session',
  'payload',
  'endpoint',
  'atomic',
  'instance',
] as const;

/**
 * Every sentence on this banner.
 *
 * Two constraints beyond §7:
 *   - It says a truck is COMING, never that a run is finished. The driver's
 *     "heading back" is a milestone inside `IN_PROGRESS` (I27); only the
 *     receiver's receive-done completes anything (I11/D7), and that is S2.2b.
 *   - It asks for nothing. Dismiss is the only control, it needs no login, and it
 *     must not read as a task — someone mid-weighing has to be able to clear it
 *     and carry on without wondering what they just agreed to.
 */
export const TRUCK_INBOUND_COPY = {
  title: 'Truck inbound',
  fallbackBody: 'A run is heading back.',
  dismiss: 'Got it',
  /** Screen-reader name for the banner region. */
  regionLabel: 'Truck inbound',
} as const;
