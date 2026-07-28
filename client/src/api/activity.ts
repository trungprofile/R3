// When the app last successfully talked to the server.
//
// Why this exists: `architecture.md §4.2` slides `session.last_seen_at` on every
// authenticated request, so the real expiry moves every time a screen fetches
// anything. The "Still here?" prompt (`ui-ux-spec.md §5`) has to know roughly
// when the sign-in will lapse in order to warn 30 seconds ahead of it.
//
// The obvious alternative — polling the server for the current expiry — is
// exactly wrong: the poll is itself an authenticated request, so it would slide
// the timeout forever and the inactivity timeout would never fire at all.
//
// So the client mirrors the server's slide locally, from traffic it already
// made. Expiry stays server-authoritative; this only decides WHEN TO WARN. If
// the estimate is wrong the worst case is a prompt at a slightly wrong moment,
// and the real sign-out still arrives as a 401 from the server.

type Listener = (at: number) => void;

const listeners = new Set<Listener>();
let lastAt = Date.now();

export function lastActivityAt(): number {
  return lastAt;
}

/** Called by the fetch wrapper on every successful response. */
export function reportActivity(): void {
  lastAt = Date.now();
  for (const listener of listeners) listener(lastAt);
}

export function subscribeToActivity(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
