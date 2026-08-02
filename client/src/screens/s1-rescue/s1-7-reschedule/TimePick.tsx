// From / Until — S1.7's two time fields.
//
// This was `TimeGrid`: every option on screen as a big button, twice over. That
// reading of §1.5 ("not a dropdown, not a native time field, not a spinner") is
// still the rule and is still met — `components/TimeField.tsx` opens a plain list
// of big rows, not a widget — but two full grids stacked above the read-back pushed
// the primary action off the screen, and the finer steps S1.6 now offers cannot be
// laid out as a grid at all.
//
// So the file is a thin binding: this screen's own `formatTimeLabel`, and its label.
// The values stay pantry-local `HH:MM` and leave the screen unchanged (`logic.ts`'s
// header). Nothing here touches a `Date`.

import { TimeField } from '../../../components/index.ts';
import { formatTimeLabel } from './logic.ts';

export interface TimePickProps {
  label: string;
  /** Always set on this screen: the form is prefilled from the run's own window. */
  value: string;
  options: readonly string[];
  onSelect: (time: string) => void;
}

export function TimePick({ label, value, options, onSelect }: TimePickProps) {
  return (
    <div className="s17-times">
      <TimeField
        label={label}
        value={value}
        options={options}
        format={formatTimeLabel}
        onSelect={onSelect}
      />
    </div>
  );
}
