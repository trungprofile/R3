// Small pieces used by more than one of S1.8's four sub-screens.
//
// These live in this folder rather than in `components/` deliberately: they are the
// admin form's own furniture, and §3's component set is deliberately small. If a
// second screen ever wants one, that is the signal to promote it.
//
// What is NOT here, because §3 already ships it: Button, TextInput, ListRow,
// Segmented, Modal/ConfirmModal, the numeric keypad, and the three list blocks.

import type { ReactNode } from 'react';
import { NumericKeypad, TextInput } from '../../../components/index.ts';
import { PIN_LENGTH } from '../../../api/shared.ts';
import { COPY, DUTY_LABELS, toggleDuty } from './logic.ts';
import { DUTIES } from '../../../api/shared.ts';
import type { CredentialPlan } from './logic.ts';
import type { Duty } from '../../../api/shared.ts';

/**
 * A labelled group around something that is not a single input — the tier row, the
 * duty toggles, the PIN keypad. `role="group"` with the label as its accessible
 * name, because a `<label>` can only point at one control.
 */
export function FieldGroup({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="s18-group" role="group" aria-label={label}>
      <p className="s18-group__label">{label}</p>
      {children}
      {hint !== undefined ? <p className="s18-hint">{hint}</p> : null}
      {error !== undefined && error !== null ? (
        <p className="s18-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A value the admin may read but never type. Used for the username, which is
 * generated (`domain-modeling.md §5.1`) and immutable after creation (I3) — so it
 * is rendered as text, not as a disabled input: a greyed-out field invites the
 * reading "editable later", and there is no later.
 */
export function ReadOnlyValue({
  label,
  value,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  placeholder: string;
  hint: string;
}) {
  return (
    <div className="s18-group">
      <p className="s18-group__label">{label}</p>
      <p className={value === '' ? 's18-readonly s18-readonly--empty' : 's18-readonly'}>
        {value === '' ? placeholder : value}
      </p>
      <p className="s18-hint">{hint}</p>
    </div>
  );
}

/** A row that is out of use, in §3's muted chip. The word depends on the entity
 *  and nothing else (`inactiveLabel`). */
export function InactiveChip({ label }: { label: string }) {
  return <span className="r3-chip r3-chip--muted">{label}</span>;
}

/**
 * I2 — duties are SET MEMBERSHIP, so this is three independent toggles and not a
 * segmented row: holding Drive implies nothing about Receive, none is required,
 * and all three at once is ordinary. A single-pick control here would be a
 * category error, which is exactly the mistake I1 and I2 sitting side by side
 * invites.
 */
export function DutyToggles({
  held,
  onChange,
  disabled,
}: {
  held: readonly Duty[];
  onChange: (next: Duty[]) => void;
  disabled: boolean;
}) {
  return (
    <div className="s18-toggles">
      {DUTIES.map((duty) => {
        const on = held.includes(duty);
        return (
          <button
            key={duty}
            type="button"
            className={on ? 's18-toggle is-on' : 's18-toggle'}
            aria-pressed={on}
            disabled={disabled}
            onClick={() => onChange(toggleDuty(held, duty))}
          >
            {DUTY_LABELS[duty]}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The PIN or password field. WHICH ONE IS NOT A CHOICE: it follows the tier
 * (`credentialKindFor`, `architecture.md §4.2`), so this takes the plan and
 * renders it rather than offering both.
 *
 * A PIN goes through the on-screen keypad, never the system keyboard (§1
 * principle 5, §3: "the only weight/PIN input"). Its digits are shown in the
 * clear, unlike S1.1's dots, because the admin is setting a number for someone
 * else and has to be able to read it back to them.
 */
export function CredentialField({
  plan,
  value,
  onChange,
  error,
  disabled,
}: {
  plan: CredentialPlan;
  value: string;
  onChange: (next: string) => void;
  error?: string | undefined;
  disabled: boolean;
}) {
  if (plan.kind === 'PASSWORD') {
    return (
      <div className="s18-group">
        <TextInput
          label={plan.label}
          type="password"
          value={value}
          onChange={onChange}
          disabled={disabled}
          autoComplete="new-password"
          hint={plan.hint}
          {...(error !== undefined ? { error } : {})}
        />
        {plan.reason !== null ? <p className="s18-hint s18-hint--strong">{plan.reason}</p> : null}
      </div>
    );
  }

  return (
    <FieldGroup label={plan.label} hint={plan.hint} error={error ?? null}>
      <p className="s18-pin" aria-hidden="true">
        {value === '' ? '—' : value}
      </p>
      <p className="r3-sr-only" role="status">
        {value.length} of {PIN_LENGTH} digits entered
      </p>
      <NumericKeypad
        value={value}
        onChange={onChange}
        maxLength={PIN_LENGTH}
        ariaLabel={COPY.credential.pinKeypad}
        disabled={disabled}
      />
      {plan.reason !== null ? <p className="s18-hint s18-hint--strong">{plan.reason}</p> : null}
    </FieldGroup>
  );
}
