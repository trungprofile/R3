// Numeric keypad — `ui-ux-spec.md §3`.
//
// The ONLY weight/PIN input. Never the system keyboard: §1 principle 5 rules out
// tiny keys for this population, and the PIN screen and the weight sheet are the
// two places numbers get typed at all.
//
// Keys are >=64px. The component holds no value of its own — the screen owns the
// digits so it can render them its own way (PIN dots, a big tabular weight).

import type { ReactNode } from 'react';
import { BackspaceIcon } from './icons.tsx';

export interface NumericKeypadProps {
  value: string;
  onChange: (next: string) => void;
  /** Weights need a decimal point; a PIN does not. */
  allowDecimal?: boolean;
  /** Digits accepted, decimal point not counted. A PIN is 4. */
  maxLength?: number;
  /** Names the thing being typed, e.g. "PIN keypad". */
  ariaLabel?: string;
  disabled?: boolean;
}

const DIGIT_ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
];

function digitCount(value: string): number {
  return value.replace('.', '').length;
}

export function NumericKeypad({
  value,
  onChange,
  allowDecimal = false,
  maxLength,
  ariaLabel = 'Number keypad',
  disabled = false,
}: NumericKeypadProps) {
  const press = (key: string) => {
    if (key === 'backspace') {
      onChange(value.slice(0, -1));
      return;
    }
    if (key === '.') {
      if (!allowDecimal || value.includes('.')) return;
      onChange(value === '' ? '0.' : `${value}.`);
      return;
    }
    if (maxLength !== undefined && digitCount(value) >= maxLength) return;
    onChange(`${value}${key}`);
  };

  const key = (label: string, action: string, node?: ReactNode) => (
    <button
      key={action}
      type="button"
      className="r3-keypad__key"
      onClick={() => press(action)}
      disabled={disabled}
      aria-label={label}
    >
      {node ?? label}
    </button>
  );

  return (
    <div className="r3-keypad" role="group" aria-label={ariaLabel}>
      {DIGIT_ROWS.flat().map((digit) => key(digit, digit))}
      {allowDecimal ? (
        // The key reads "." and is NAMED "Decimal point". `key()` already puts the
        // name on every button as `aria-label`, so passing the glyph as the child is
        // the whole change — a screen reader announcing "full stop" or nothing at all
        // is not a label a volunteer can act on (§3: never icon-only).
        key('Decimal point', '.', '.')
      ) : (
        <span className="r3-keypad__key r3-keypad__key--blank" aria-hidden="true" />
      )}
      {key('0', '0')}
      {key('Backspace', 'backspace', <BackspaceIcon />)}
    </div>
  );
}
