// The name this browser opens on.
//
// `ui-ux-spec.md §5`: "Login (personal phone): same, but device may remember the
// user, so it opens to the PIN keypad with the name pre-shown." A shared device
// must never do this — §5 gives shared devices a name list every time, and a
// tablet that opens on the last receiver's name would be putting a person's
// identity on a counter for the next person to sign in as.
//
// Which device this is, is not something the browser can assert: `architecture.md
// §4.2` classifies devices by a marker the admin registered, and the answer comes
// back on the sign-in response as `sharedDevice`. So the name is written AFTER a
// successful sign-in, from the server's own verdict, and a shared verdict erases
// whatever was there — a tablet that was mis-registered once and fixed later
// cleans itself up on the next sign-in.
//
// Browser-local, not server state: no table holds it (`server/migrations/` is
// lead-owned, build-plan §3), it is per-BROWSER rather than per-person, and losing
// it costs one tap on a name list.

const KEY = 'r3.login.name';

/** The three methods this needs, so a test can pass a plain object. */
export interface NameStore {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

/** Safari in private browsing throws on `localStorage`, and a login screen that
 *  cannot render is worse than one that forgets. Every access is guarded. */
export function browserStore(): NameStore | null {
  try {
    const store = window.localStorage;
    const probe = `${KEY}.probe`;
    store.setItem(probe, '1');
    store.removeItem(probe);
    return store;
  } catch {
    return null;
  }
}

export function readRemembered(store: NameStore | null): string | null {
  if (!store) return null;
  try {
    const raw = store.getItem(KEY);
    return raw && raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Called once a sign-in is accepted. `sharedDevice` is the server's, never the
 * client's guess.
 */
export function rememberAfterSignIn(
  store: NameStore | null,
  username: string,
  sharedDevice: boolean,
): void {
  try {
    if (sharedDevice) store?.removeItem(KEY);
    else store?.setItem(KEY, username);
  } catch {
    // Nothing to do and nothing to say: the next visit shows the name list.
  }
}

/** "Not you? Choose a different name" — the way out of a remembered name, and the
 *  reason remembering is never a dead end. */
export function forget(store: NameStore | null): void {
  try {
    store?.removeItem(KEY);
  } catch {
    // As above.
  }
}
