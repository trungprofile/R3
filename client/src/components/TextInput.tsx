// Text input — `ui-ux-spec.md §3`.
//
// 48px tall, 18px text, and a VISIBLE LABEL ABOVE — never placeholder-only, which
// disappears the moment someone starts typing and is exactly the recall the
// design principles rule out (§1.4). Used sparingly: notes and names in admin.
//
// Numbers never come through here. §1 principle 5 makes the on-screen keypad the
// only weight/PIN input.

import { useId } from 'react';
import type { ChangeEvent } from 'react';

export interface TextInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Rendered under the field, in danger colour. Plain, and what to do about it. */
  error?: string;
  hint?: string;
  placeholder?: string;
  disabled?: boolean;
  autoComplete?: string;
  /** `text` or `password` only — Staff/Admin passwords (`architecture.md §4.2`). */
  type?: 'text' | 'password';
  /** Multi-line, for notes. */
  multiline?: boolean;
}

export function TextInput({
  label,
  value,
  onChange,
  error,
  hint,
  placeholder,
  disabled = false,
  autoComplete,
  type = 'text',
  multiline = false,
}: TextInputProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ');

  const handle = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    onChange(event.target.value);
  };

  const shared = {
    id,
    className: 'r3-field__control',
    value,
    onChange: handle,
    disabled,
    'aria-invalid': error ? (true as const) : undefined,
    'aria-describedby': describedBy || undefined,
    ...(placeholder ? { placeholder } : {}),
    ...(autoComplete ? { autoComplete } : {}),
  };

  return (
    <div className={`r3-field${error ? ' r3-field--invalid' : ''}`}>
      <label className="r3-field__label" htmlFor={id}>
        {label}
      </label>
      {multiline ? (
        <textarea {...shared} rows={3} />
      ) : (
        <input {...shared} type={type} inputMode="text" />
      )}
      {hint ? (
        <p className="r3-field__hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="r3-field__error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
