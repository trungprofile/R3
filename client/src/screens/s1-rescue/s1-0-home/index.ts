// Home — the hub at `/` (D22). The barrel `main.tsx`'s screen registry imports from:
//
//   home: HomeScreen,
//
// Not an S1.x screen: `ui-ux-spec.md §8` has no Home, and this is a flagged spec
// addition rather than an implementation of one. It sits in `s1-rescue/` because the
// rescue loop is where a signed-in user starts.

export { HomeScreen } from './HomeScreen.tsx';

// Exported for tests and for anyone tracing the hub's rules. Nothing outside this
// folder needs them.
export { COPY, hasNothingAssigned, homeCardsFor } from './home.ts';
export type { HomeCard, LiveSubtitles } from './home.ts';
