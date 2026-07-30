// "Still here?" — `ui-ux-spec.md §5` and §6.
//
// "Timeout shows a 30s 'Still here?' prompt before logging out, so a mid-weighing
// volunteer is never dumped silently."
//
// Expiry is server-authoritative (`architecture.md §4.2`); this only decides when
// to warn, from the expiry the server reported. Answering "I'm still here"
// re-reads the signed-in user, and that authenticated request is what actually
// slides the timeout — the prompt has no special power of its own.

import { useEffect, useState } from 'react';
import { Button, Modal } from '../components/index.ts';
import { duration } from '../tokens/index.ts';
import { useSession } from './SessionProvider.tsx';

/**
 * `setTimeout` stores its delay in a 32-bit signed integer, so a delay above this
 * **fires immediately** instead of waiting — it does not throw, and nothing warns
 * in a browser.
 *
 * This is not a theoretical limit here, it is the common case: a Volunteer on their
 * own phone gets a 30-day window (`session.ts`'s `computeExpiry`), which is 2.59e9
 * ms and comfortably over the ceiling. Left unclamped, "Still here?" appeared within
 * milliseconds of signing in, on every load, counting down from 2,591,970 seconds —
 * and answering it re-read a session that was still 30 days out, so it came straight
 * back. Staff (7 days) and any shared device (30 min idle / 12 h cap) stayed under
 * the ceiling, which is why it hid: it broke for exactly the driver-on-a-phone
 * persona the rescue loop is canonical for, and for nobody else.
 */
const MAX_TIMEOUT_MS = 2_147_483_647;

/** How long to sleep before re-checking. Capped so the wait is re-armed in chunks
 *  rather than overflowing; each wake recomputes against the real clock. */
export function idleTimerDelay(msUntilPrompt: number): number {
  return Math.min(msUntilPrompt, MAX_TIMEOUT_MS);
}

export function IdlePrompt() {
  const { status, expiresAt, refresh, signOut } = useSession();
  const [showing, setShowing] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    if (status !== 'signed-in' || expiresAt === null) {
      setShowing(false);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Re-arms itself until the prompt is actually due. Recomputing the remaining
    // time on each wake also means a laptop that slept through several chunks
    // corrects on the next one instead of drifting.
    const arm = () => {
      const msUntilPrompt = expiresAt - Date.now() - duration.idlePromptMs;
      if (msUntilPrompt <= 0) {
        setShowing(true);
        return;
      }
      setShowing(false);
      timer = setTimeout(arm, idleTimerDelay(msUntilPrompt));
    };
    arm();
    return () => {
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [status, expiresAt]);

  // Count down while the prompt is up, and when it runs out let the server have
  // the last word: re-reading the session returns 401 and the shell falls back
  // to the login screen.
  useEffect(() => {
    if (!showing || expiresAt === null) return;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining === 0) void refresh();
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [showing, expiresAt, refresh]);

  if (!showing) return null;

  return (
    <Modal
      question="Still here?"
      showCancel={false}
      // Escape and a click outside are the calm answer, never the one that signs
      // someone out (§6: the destructive path is never the default).
      onCancel={() => void refresh()}
      actions={
        <Button variant="primary" onClick={() => void refresh()}>
          I'm still here
        </Button>
      }
    >
      <>
        You'll be signed out in {secondsLeft} seconds.{' '}
        <button type="button" className="r3-linkish" onClick={() => void signOut()}>
          Log out now
        </button>
      </>
    </Modal>
  );
}
