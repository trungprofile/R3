// Back — one way out of a screen.
//
// Before this there was none. The QA pass found that leaving a shift detail meant
// pressing the browser's back button, and the eleven places that *did* offer a way
// back each invented their own words for it ("Back to the runs", "Back to the
// list", "Back to accounts", "Cancel"). Eleven spellings of one idea is eleven
// things to learn.
//
// It sits at the TOP of a screen, before the heading, because that is where a
// person looks for it and because a back control at the bottom is only reachable
// after scrolling past everything they wanted to leave.
//
// Not a `<Link>`: the destination is usually a screen ID or a state change inside a
// panel, not always a URL. Callers that do navigate hand it `go(...)`.

import { ChevronLeftIcon } from './icons.tsx';

export interface BackLinkProps {
  /** Where it goes, in the user's words: "Board", "Accounts", "This run".
   *  A noun, not a sentence — the chevron already says "back". */
  label: string;
  onBack: () => void;
}

export function BackLink({ label, onBack }: BackLinkProps) {
  return (
    <button type="button" className="r3-back" onClick={onBack}>
      <ChevronLeftIcon />
      <span>{label}</span>
    </button>
  );
}
