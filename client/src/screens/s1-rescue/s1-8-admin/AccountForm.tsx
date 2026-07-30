// S1.8 Accounts — the add/edit form.
//
// The one screen in Phase 1 where I1, I2 and I3 are all visible at once, and they
// are three different kinds of thing:
//
//   I3 username — GENERATED and immutable after creation. Read-only text, both on
//                 create (a preview of what §5.1 will produce) and on edit (the
//                 real one). `UpdateUserRequest` has no `username` field to send.
//   I1 tier     — a hierarchy, so ONE pick from a segmented row.
//   I2 duties   — a set, so INDEPENDENT toggles.
//
// The credential is derived from the tier and never asked about
// (`credentialKindFor`): a volunteer gets the keypad, staff and admins a password
// field, and a tier change across that line makes a new one necessary.
//
// Everything that is a rule rather than a pixel is in `logic.ts` and tested.

import { useState } from 'react';
import { Button, Segmented, TextInput } from '../../../components/index.ts';
import type { ShapedUser } from '../../../api/shared.ts';
import {
  COPY,
  accountFormFrom,
  credentialPlan,
  EMPTY_ACCOUNT_FORM,
  isValid,
  tierChoices,
  usernamePreview,
  validateAccount,
  type AccountForm as AccountFormValues,
  type FormMode,
} from './logic.ts';
import { CredentialField, DutyToggles, FieldGroup, ReadOnlyValue } from './parts.tsx';

export interface AccountFormProps {
  mode: FormMode;
  /** The account being edited, or null when adding. */
  existing: ShapedUser | null;
  /** Every username already on screen, so the preview can show the collision
   *  suffix §5.1 would add. Includes deactivated accounts — their handles stay
   *  reserved (I3). */
  taken: readonly string[];
  busy: boolean;
  /** A refusal from the server, already turned into a sentence. */
  failure: string | null;
  onSubmit: (values: AccountFormValues) => void;
  onCancel: () => void;
  /** Absent when removal is not offered here: S1.8 removes NON-ADMIN accounts
   *  only, and the server refuses an admin removal again with a 403. */
  onRemove?: () => void;
}

export function AccountForm({
  mode,
  existing,
  taken,
  busy,
  failure,
  onSubmit,
  onCancel,
  onRemove,
}: AccountFormProps) {
  const [values, setValues] = useState<AccountFormValues>(() =>
    existing === null ? EMPTY_ACCOUNT_FORM : accountFormFrom(existing),
  );
  // Errors appear once Save has been pressed, not while the name is half-typed:
  // a form that turns red as you start is noise, and §6's error pattern is about
  // what to do next.
  const [attempted, setAttempted] = useState(false);

  const plan = credentialPlan(mode, values.tier, existing);
  const errors = validateAccount(values, plan);
  const shown = attempted ? errors : {};

  const patch = (part: Partial<AccountFormValues>) => setValues({ ...values, ...part });

  // I3 — on create this is what §5.1 will most likely produce, on edit it is the
  // real one, and in both cases it is text the admin reads rather than a field.
  const username =
    existing === null
      ? usernamePreview(values.firstName, values.lastName, taken)
      : existing.username;

  return (
    <form
      className="s18-form"
      onSubmit={(event) => {
        event.preventDefault();
        setAttempted(true);
        if (!isValid(errors)) return;
        onSubmit(values);
      }}
    >
      <h2 className="s18-subheading">
        {mode === 'create' ? COPY.accounts.createTitle : COPY.accounts.editTitle}
      </h2>

      {/* I21 — a deactivated account is kept, not destroyed, and its details stay
          editable ("field edits are always allowed"). */}
      {existing !== null && !existing.active ? (
        <p className="s18-notice">{COPY.accounts.deactivated}</p>
      ) : null}

      <TextInput
        label={COPY.accounts.firstName}
        value={values.firstName}
        onChange={(firstName) => patch({ firstName })}
        disabled={busy}
        autoComplete="off"
        {...(shown['firstName'] !== undefined ? { error: shown['firstName'] } : {})}
      />
      <TextInput
        label={COPY.accounts.lastName}
        value={values.lastName}
        onChange={(lastName) => patch({ lastName })}
        disabled={busy}
        autoComplete="off"
        {...(shown['lastName'] !== undefined ? { error: shown['lastName'] } : {})}
      />

      <ReadOnlyValue
        label={COPY.accounts.username}
        value={username}
        placeholder={COPY.accounts.usernamePending}
        hint={
          mode === 'create'
            ? `${COPY.accounts.usernameHint} ${COPY.accounts.usernameCollisionHint}`
            : COPY.accounts.usernameHint
        }
      />

      {/* I1 — one pick from an ordered ladder. §3 sanctions the segmented control
          "wherever a screen offers a small, fixed set of choices"; this is not
          `mode="tabs"` because nothing here switches a panel. */}
      <FieldGroup
        label={COPY.accounts.tier}
        hint={
          mode === 'create'
            ? `${COPY.accounts.tierHint} ${COPY.accounts.tierAdminOnCreate}`
            : COPY.accounts.tierHint
        }
      >
        <Segmented
          label={COPY.accounts.tier}
          options={tierChoices(mode)}
          value={values.tier}
          onChange={(tier) => patch({ tier })}
        />
      </FieldGroup>

      {/* I2 — set membership, so toggles. */}
      <FieldGroup label={COPY.accounts.duties} hint={COPY.accounts.dutiesHint}>
        <DutyToggles
          held={values.duties}
          onChange={(duties) => patch({ duties })}
          disabled={busy}
        />
      </FieldGroup>

      {/* PII (phone/address on a person). This screen is admin-only, and Admin is
          the only tier that may EDIT these — Staff sees them to phone a driver
          (`product-requirement.md §2`, enforced in `pii.ts` and on the route). */}
      <TextInput
        label={COPY.accounts.phone}
        value={values.phone}
        onChange={(phone) => patch({ phone })}
        disabled={busy}
        autoComplete="off"
        hint={COPY.accounts.phoneHint}
      />
      <TextInput
        label={COPY.accounts.address}
        value={values.address}
        onChange={(address) => patch({ address })}
        disabled={busy}
        autoComplete="off"
      />

      <CredentialField
        plan={plan}
        value={values.credential}
        onChange={(credential) => patch({ credential })}
        disabled={busy}
        {...(shown['credential'] !== undefined ? { error: shown['credential'] } : {})}
      />

      {failure !== null ? (
        <p className="s18-error" role="alert">
          {failure}
        </p>
      ) : null}

      <div className="s18-actions">
        {/* The one primary action (§1 principle 1). S1.8: "Primary action varies
            per sub-screen (Save)." */}
        <Button variant="primary" type="submit" loading={busy}>
          {mode === 'create' ? COPY.accounts.create : COPY.accounts.save}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          {COPY.accounts.back}
        </Button>
      </div>

      {mode === 'edit' ? (
        <div className="s18-danger-zone">
          {onRemove === undefined ? (
            // Hidden rather than disabled, with the reason in words: S1.8 removes
            // non-admin accounts only, and a greyed button with no explanation
            // reads as a fault.
            <p className="s18-hint">{COPY.accounts.adminNotRemovable}</p>
          ) : (
            <Button variant="danger" onClick={onRemove} disabled={busy}>
              {COPY.accounts.remove}
            </Button>
          )}
        </div>
      ) : null}
    </form>
  );
}
