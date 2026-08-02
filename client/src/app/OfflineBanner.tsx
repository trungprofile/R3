// The blocking "You're offline" banner — `ui-ux-spec.md §6`.
//
// Offline support is a NON-GOAL (PRD, and `architecture.md §4.5`): "If the network
// drops, show a blocking banner. Do not fake offline capability."
//
// The banner is the title alone. §6's second sentence, "R3 needs a connection.",
// only restates the first under it, so D21 deletes it here; the wording survives
// intact in `api/errors.ts`, where a failed request has no heading to lean on.
//
// Blocking is the point. Anything a volunteer taps without a connection fails,
// and a half-working screen teaches them the app is unreliable rather than that
// the network is. So this covers the app and takes the taps.

import { useEffect, useState } from 'react';
import { isOnline, subscribeToConnection } from '../api/connection.ts';

export function OfflineBanner() {
  const [online, setOnline] = useState(isOnline);

  useEffect(() => subscribeToConnection(setOnline), []);

  if (online) return null;

  return (
    <div className="r3-offline" role="alert">
      <div className="r3-offline__banner">
        <p className="r3-offline__title">You're offline.</p>
      </div>
    </div>
  );
}
