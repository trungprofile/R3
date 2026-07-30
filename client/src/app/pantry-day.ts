// Which calendar day it is *for the pantry* — a shell concern, because the pantry's
// zone arrives on the session (`SessionResponse.timezone`, A120) and every screen
// that bounds a fetch by day or writes a day heading needs the same answer.
//
// This lives beside `SessionProvider` rather than in a screen folder because two
// screens had already answered it differently: S1.2's board used the DEVICE's date
// for its `?from=` bound (A121, whose stated reason — "the client has no access to
// `app_config.timezone`" — stopped being true when A120 landed), while S1.3 computed
// the pantry's. A run's date is a pantry-local fact, so the device's answer is simply
// wrong near midnight, and wrong in a way nobody would see until a driver in another
// zone found the board empty.

/** Today by the device's own clock. Only correct as a fallback — see `todayInZone`. */
export function deviceToday(now: Date = new Date()): string {
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * Today as a PANTRY-local calendar slot (A120), which is the frame every
 * `occurrenceDate` is stated in.
 *
 * The device's date is not interchangeable with it: a day heading would read
 * "Tomorrow" for the pantry's today to anyone whose phone has already rolled over,
 * and a fetch bounded by day would ask for the wrong day's runs outright. Falls back
 * to the device only when no zone has arrived yet, since there is nothing else to use.
 */
export function todayInZone(
  /** `useSession().timezone` is `null` until the session arrives, so this takes the
   *  nullable shape directly rather than making every caller launder it. */
  timeZone?: string | null,
  now: Date = new Date(),
): string {
  if (!timeZone) return deviceToday(now);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: string): string =>
    parts.find((candidate) => candidate.type === type)?.value ?? '';
  const year = part('year');
  const month = part('month');
  const day = part('day');
  if (year === '' || month === '' || day === '') return deviceToday(now);
  return `${year}-${month}-${day}`;
}
