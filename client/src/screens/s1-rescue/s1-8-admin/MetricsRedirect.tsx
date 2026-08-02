// `/metrics` — a bookmark, not a screen, since D18.
//
// S3.2 had its own route and its own left-nav entry through Phase 3. Folding it
// into S1.8 as a tab (`AdminScreen.tsx`) would have made that URL a 404 for anyone
// who had saved it, and "the metrics page is gone" is a worse first impression of
// a reorganisation than a page that simply lands where it moved to.
//
// So the route SURVIVES, still declared `requires: { tier: 'ADMIN' }` — it is
// still gated, which is what `architecture.md §4.3`'s default-deny is about: a
// route with no requirement is rejected, not open, and a redirect is no exception.
// Anyone below Admin meets the shell's no-access state here exactly as before,
// rather than being bounced to a tab they cannot see either.
//
// `replace`, not push: the address someone typed is a synonym for where they are
// going, and leaving it in the history would make Back a loop.

import { useEffect } from 'react';
import type { ScreenProps } from '../../../app/index.ts';
import { routeById, useRouter } from '../../../app/index.ts';
import { PANEL_QUERY_KEY } from './logic.ts';

const TO = `${routeById('admin').path}?${PANEL_QUERY_KEY}=metrics`;

export function MetricsRedirect(_props: ScreenProps) {
  const { navigate } = useRouter();

  useEffect(() => {
    navigate(TO, { replace: true });
  }, [navigate]);

  // Nothing on screen: this state lasts one paint, and a "Redirecting…" line that
  // flashes is noise rather than information (§1.7).
  return null;
}
