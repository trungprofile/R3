// From / Until — a visible grid of big time buttons.
//
// §1.5 again: not a dropdown, not a native time field, not a spinner. Every option
// is on screen and every one is a ≥44px target.
//
// The values are pantry-local `HH:MM` and they leave the screen unchanged
// (`logic.ts`'s header). Nothing here touches a `Date`.

import { formatTimeLabel } from './logic.ts';

export interface TimeGridProps {
  label: string;
  value: string;
  options: readonly string[];
  onSelect: (time: string) => void;
}

export function TimeGrid({ label, value, options, onSelect }: TimeGridProps) {
  return (
    <fieldset className="s17-times">
      <legend className="s17-label">{label}</legend>
      <div className="s17-times__grid">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            className={`s17-time${option === value ? ' s17-time--active' : ''}`}
            aria-pressed={option === value}
            onClick={() => onSelect(option)}
          >
            {formatTimeLabel(option)}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
