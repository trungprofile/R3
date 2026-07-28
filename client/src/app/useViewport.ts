// Which of the three surfaces we are on — `ui-ux-spec.md §0` and the responsive
// matrix at the end of the spec.
//
// The spec names the devices (phone / tablet / desktop) and what each is
// canonical for, but states no pixel breakpoints; these are ours (see the
// report's `Assumed:`). They are width-only on purpose — an orientation-aware
// rule would flip the pantry tablet's whole navigation when someone stands it up.

import { useEffect, useState } from 'react';
import { breakpoint } from '../tokens/index.ts';

export type Viewport = 'phone' | 'tablet' | 'desktop';

function classify(width: number): Viewport {
  if (width >= breakpoint.desktopMinPx) return 'desktop';
  if (width >= breakpoint.tabletMinPx) return 'tablet';
  return 'phone';
}

export function useViewport(): Viewport {
  const [viewport, setViewport] = useState<Viewport>(() => classify(window.innerWidth));

  useEffect(() => {
    const onResize = () => setViewport(classify(window.innerWidth));
    window.addEventListener('resize', onResize);
    // A rotation or a resized desktop window changes the surface, and the nav
    // has to follow — §4 gives each device a different one.
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return viewport;
}
