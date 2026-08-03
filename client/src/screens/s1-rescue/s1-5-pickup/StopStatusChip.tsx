// A stop's disposition, as the pill §3 fixes for a row's status.
//
// WHY THIS IS NOT `components/StatusChip.tsx`. That component is the same pill,
// and this reuses its `.r3-chip` base class rather than restyling one — but its
// props are a `ShiftStatus` and its words are a shift's ("Open", "Claimed",
// "In progress"). A stop's disposition is a different enum with different words,
// and §3's rule is that the colour never carries meaning the word does not, so
// borrowing the shift chip would have meant borrowing the wrong label. The tones
// are the shared vocabulary; only the labels are this screen's.
//
// Which tone goes where is `stopStatusTone` in `logic.ts`, so it is testable and
// stated once. The strongest weight goes to a stop still to do: "what is left" is
// the only question a driver asks this list.

import type { ShiftStopDisposition } from '../../../api/shared.ts';
import { stopStatusLabel, stopStatusTone } from './logic.ts';

export interface StopStatusChipProps {
  disposition: ShiftStopDisposition;
}

export function StopStatusChip({ disposition }: StopStatusChipProps) {
  return (
    <span className={`r3-chip r3-stop-chip--${stopStatusTone(disposition)}`}>
      {stopStatusLabel(disposition)}
    </span>
  );
}
