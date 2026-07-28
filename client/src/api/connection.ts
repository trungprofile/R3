// Connection state for the blocking "You're offline" banner (`ui-ux-spec.md §6`).
//
// Offline support is an explicit non-goal (`architecture.md §4.5`): nothing here
// queues, caches or replays a request. It only tells the shell whether to put the
// banner up, so the app never pretends to work without a network.
//
// Two signals, because neither alone is honest:
//   - the browser's online/offline events, which are instant but optimistic
//     (`navigator.onLine` true only means a link exists, not that we can reach
//     the server)
//   - an actual request that failed at the network layer, reported by the fetch
//     wrapper, which is the ground truth
//
// A request that later succeeds clears the state again.

type Listener = (online: boolean) => void;

const listeners = new Set<Listener>();

/** Set when a request fails at the network layer while `navigator.onLine` still
 *  claims we are connected. Cleared by the next successful request. */
let networkFailed = false;

function browserOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

export function isOnline(): boolean {
  return browserOnline() && !networkFailed;
}

function emit(): void {
  const online = isOnline();
  for (const listener of listeners) listener(online);
}

/** Called by the fetch wrapper when a request dies before it got a response. */
export function reportNetworkFailure(): void {
  if (networkFailed) return;
  networkFailed = true;
  emit();
}

/** Called by the fetch wrapper on any response at all — we reached the server. */
export function reportNetworkSuccess(): void {
  if (!networkFailed) return;
  networkFailed = false;
  emit();
}

export function subscribeToConnection(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    // The browser says the link is back. Believe it enough to drop the banner;
    // the next failing request puts it straight back up.
    networkFailed = false;
    emit();
  });
  window.addEventListener('offline', emit);
}
