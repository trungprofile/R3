// Small pieces used by more than one of S1.8's four sub-screens.
//
// These live in this folder rather than in `components/` deliberately: they are the
// admin form's own furniture, and §3's component set is deliberately small. If a
// second screen ever wants one, that is the signal to promote it.
//
// What is NOT here, because §3 already ships it: Button, TextInput, ListRow,
// Segmented, Modal/ConfirmModal, the numeric keypad, and the three list blocks.

import { useId, useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { Button, ImageIcon, NumericKeypad, TextInput } from '../../../components/index.ts';
import { DUTIES, PIN_LENGTH } from '../../../api/shared.ts';
import type { Duty } from '../../../api/shared.ts';
import { COPY, DUTY_LABELS, toggleDuty } from './logic.ts';
import type { CredentialPlan } from './logic.ts';
import { resizedPhotoDataUrl } from './photo.ts';

/**
 * A labelled group around something that is not a single input — the tier row, the
 * duty toggles, the PIN keypad. `role="group"` labelled BY the visible text rather
 * than by a copy of it in `aria-label`: a `<label>` can only point at one control,
 * and two copies of the same sentence drift.
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
  const id = useId();
  return (
    <div className="s18-group" role="group" aria-labelledby={id}>
      <p className="s18-group__label" id={id}>
        {label}
      </p>
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
/** The empty-value glyph. Not a sentence, so D21's ban on em dashes in prose does
 *  not reach it — this is the same mark the PIN field shows before any digits. */
const EMPTY_VALUE = '—';

export function ReadOnlyValue({
  label,
  value,
  placeholder = EMPTY_VALUE,
  hint,
}: {
  label: string;
  value: string;
  /** What stands in before there is a value. Defaults to the em dash R3 uses
   *  everywhere for "nothing here yet" — a glyph, not prose (D21). */
  placeholder?: string;
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
 * D20 — a master record's picture, for the `kind: 'image'` field a config declares.
 *
 * §3 ships no file control, and this is not a new one: it is a hidden `<input
 * type="file">` driven by an ordinary §3 Button, because a bare file input is a
 * 20px system widget with a label nobody can change — the "fragile control" §1.5
 * rules out, and unreachable at 44px besides.
 *
 * The chosen file is resized in the browser BEFORE it becomes the field's value
 * (`photo.ts`), so what the form holds is already the small JPEG that will be sent.
 * The preview is therefore the real thing rather than an optimistic stand-in.
 */
export function ImageField({
  label,
  hint,
  value,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string | undefined;
  /** '' for none, a `data:` URL for one just chosen, otherwise the URL the stored
   *  photo is served from (`logic.ts`, `photoChange`). */
  value: string;
  onChange: (next: string) => void;
  disabled: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [working, setWorking] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Chrome fires this with no file when the picker is cancelled. Not an error,
    // and it must not wipe the photo already on file.
    if (!file) return;
    // Reset first, so choosing the SAME file again still fires a change event.
    event.target.value = '';

    if (!file.type.startsWith('image/')) {
      setFailure(COPY.photo.notAnImage);
      return;
    }

    setWorking(true);
    setFailure(null);
    try {
      onChange(await resizedPhotoDataUrl(file));
    } catch {
      // §6: what happened and what to do, never a code. The existing photo stays.
      setFailure(COPY.photo.failed);
    } finally {
      setWorking(false);
    }
  };

  return (
    <FieldGroup label={label} {...(hint !== undefined ? { hint } : {})} error={failure}>
      {value === '' ? (
        <div className="s18-photo s18-photo--empty">
          <ImageIcon size="2em" />
          <p className="s18-hint">{COPY.photo.none}</p>
        </div>
      ) : (
        <img className="s18-photo" src={value} alt={COPY.photo.alt} />
      )}

      {/* Hidden from BOTH the eye and the tab order: the Button above is the
          control, and this is the mechanism it drives. Left reachable it would be
          a stop on the keyboard path with no visible thing to focus. */}
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="r3-sr-only"
        tabIndex={-1}
        aria-hidden="true"
        disabled={disabled || working}
        onChange={(event) => void choose(event)}
      />

      <div className="s18-photo__actions">
        <Button
          variant="secondary"
          onClick={() => input.current?.click()}
          disabled={disabled}
          loading={working}
        >
          {value === '' ? COPY.photo.choose : COPY.photo.replace}
        </Button>
        {/* Hidden rather than disabled (§3): with no photo there is nothing to
            remove, and a greyed button with no explanation reads as a fault. */}
        {value === '' ? null : (
          <Button variant="secondary" onClick={() => onChange('')} disabled={disabled || working}>
            {COPY.photo.remove}
          </Button>
        )}
      </div>
    </FieldGroup>
  );
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
