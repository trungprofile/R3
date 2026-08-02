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
import { BackLink, Button, Segmented, TextInput } from '../../../components/index.ts';
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
  /** Reactivate — `domain-modeling.md §3.3`'s User lifecycle is ACTIVE ⇄
   *  DEACTIVATED, and without this the return arrow has no affordance. Only
   *  passed for an account that is actually deactivated. */
  onReactivate?: () => void;
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
  onReactivate,
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
    <>
      {/* §3's one way out, at the top where a person looks for it. A destination
          noun, not a sentence — the chevron already says "back" (D21). */}
      <BackLink label={COPY.accounts.heading} onBack={onCancel} />
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
          <div className="s18-notice s18-notice--strong">
            <p className="s18-notice__text">{COPY.accounts.deactivated}</p>
            {/* §3.3's return arrow. A plain secondary button, not a confirm: bringing
                an account back is the reversible direction — Delete is the one that
                asks. Reactivating does not touch the credential, so the copy says so
                rather than leaving an admin wondering what to tell the person. */}
            {onReactivate !== undefined ? (
              <Button variant="secondary" onClick={onReactivate} disabled={busy}>
                {COPY.accounts.reactivate}
              </Button>
            ) : null}
          </div>
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

        {/* D21 — one hint, not three. What the field showed while empty and what
            happens on a collision were both descriptions of what the admin is
            already watching happen; what they cannot see is that it is permanent. */}
        <ReadOnlyValue
          label={COPY.accounts.username}
          value={username}
          hint={COPY.accounts.usernameHint}
        />

        {/* I1 — one pick from an ordered ladder. §3 sanctions the segmented control
            "wherever a screen offers a small, fixed set of choices"; this is not
            `mode="tabs"` because nothing here switches a panel. */}
        {/* The hint survived D21's cut: `tierChoices` already leaves Admin off a
            create, so the sentence explaining that was describing an absent button.
            The ladder itself is not visible in a row of three, and this is the only
            place in R3 that says so. */}
        <FieldGroup label={COPY.accounts.tier} hint={COPY.accounts.tierHint}>
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
              per sub-screen (Save)." The way out is the BackLink above (D21). */}
          <Button variant="primary" type="submit" loading={busy}>
            {mode === 'create' ? COPY.accounts.create : COPY.accounts.save}
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
    </>
  );
}
