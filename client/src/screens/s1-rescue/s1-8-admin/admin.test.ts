// S1.8's logic, tested where a wrong answer would be silent.
//
// There is NO browser test harness in this repo — no jsdom, no component renderer
// — and adding one would be a dependency (build-plan §3/D5). So nothing here
// renders: these cover the username the admin is shown (I3), the difference
// between a hierarchy and a set (I1 vs I2), which credential a tier implies, what
// an edit actually sends, and the sentences that report I21's two branches. What
// is not covered is stated in the report rather than implied by a green run.
//
// Run: npx vitest run --root client

import { describe, expect, it } from 'vitest';
import { credentialKindFor, DUTIES, PIN_LENGTH, TIERS } from '../../../api/shared.ts';
import type { Duty, ShapedUser, Tier } from '../../../api/shared.ts';
import {
  accountFormFrom,
  accountSubtitle,
  buildCreateBody,
  buildUserSave,
  COPY,
  createdNotice,
  credentialPlan,
  crossesCredentialBoundary,
  EMPTY_ACCOUNT_FORM,
  emptyMasterValues,
  fullName,
  inactiveLabel,
  isNoOp,
  isValid,
  normalizeNamePart,
  nullableValue,
  PANELS,
  removalText,
  sameDuties,
  statusChoices,
  tierChoices,
  toggleDuty,
  trimmedValue,
  usernamePreview,
  validateAccount,
  validateMaster,
  type AccountForm,
} from './logic.ts';
import { MASTER_CONFIGS } from './masters.ts';

function user(overrides: Partial<ShapedUser> = {}): ShapedUser {
  return {
    id: 'u1',
    username: 'karensmith',
    firstName: 'Karen',
    lastName: 'Smith',
    tier: 'VOLUNTEER',
    duties: ['DRIVE'],
    active: true,
    phone: '555-867-5309',
    address: '12 Elm St',
    ...overrides,
  };
}

/** A create form: everything blank except the name. */
function form(overrides: Partial<AccountForm> = {}): AccountForm {
  return { ...EMPTY_ACCOUNT_FORM, firstName: 'Karen', lastName: 'Smith', ...overrides };
}

/** An edit form as the screen opens it — loaded FROM the account, then changed.
 *  Starting from a blank form instead would make every untouched field look like
 *  an edit, which is the opposite of what `buildUserSave` is for. */
function editForm(existing: ShapedUser, overrides: Partial<AccountForm> = {}): AccountForm {
  return { ...accountFormFrom(existing), ...overrides };
}

// ---------------------------------------------------------------------------
// The four sub-screens (S1.8 Layout)
// ---------------------------------------------------------------------------

describe('the admin shell', () => {
  it('has exactly the four sub-screens S1.8 names, in that order', () => {
    expect(PANELS.map((panel) => panel.value)).toEqual([
      'accounts',
      'donors',
      'trucks',
      'categories',
    ]);
    expect(PANELS.map((panel) => panel.label)).toEqual([
      'Accounts',
      'Donors',
      'Trucks',
      'Categories',
    ]);
  });
});

// ---------------------------------------------------------------------------
// I3 — username: generated, shown, immutable
// ---------------------------------------------------------------------------

describe('username (I3, §5.1)', () => {
  it('normalizes the way §5.1 does', () => {
    expect(normalizeNamePart('José')).toBe('jose');
    expect(normalizeNamePart("O'Brien-Núñez")).toBe('obriennunez');
    expect(normalizeNamePart('  Ann Marie ')).toBe('annmarie');
    expect(normalizeNamePart('!!!')).toBe('');
  });

  it('is first + last, lowercased and stripped', () => {
    expect(usernamePreview('Karen', 'Smith', [])).toBe('karensmith');
    expect(usernamePreview("O'Brien", 'Núñez', [])).toBe('obriennunez');
  });

  it('adds the collision suffix on the FINAL assembled string', () => {
    expect(usernamePreview('John', 'Smith', ['johnsmith'])).toBe('johnsmith2');
    // §5.1: the suffix shares the namespace, so an existing johnsmith2 pushes to 3.
    expect(usernamePreview('John', 'Smith', ['johnsmith', 'johnsmith2'])).toBe('johnsmith3');
    // A gap is not filled: the scan is from 2 upward and stops at the first free one.
    expect(usernamePreview('John', 'Smith', ['johnsmith', 'johnsmith3'])).toBe('johnsmith2');
  });

  it('counts a deactivated account as taken — a handle stays reserved', () => {
    const accounts = [user({ username: 'karensmith', active: false })];
    expect(usernamePreview('Karen', 'Smith', accounts.map((each) => each.username))).toBe(
      'karensmith2',
    );
  });

  it('shows nothing until there is a name to derive one from', () => {
    expect(usernamePreview('', '', [])).toBe('');
    // All-punctuation normalizes to nothing. §5.1's "user" fallback is the
    // SERVER's to apply — the preview stays blank rather than promising a
    // username the admin did not cause.
    expect(usernamePreview('!!!', '???', [])).toBe('');
  });

  it('is never something an edit can send', () => {
    // I3 — immutable after creation. The proof is structural: `UpdateUserRequest`
    // has no `username` field, so a patch built from the form cannot carry one.
    // Renaming the PERSON is allowed and does not renumber the handle.
    const existing = user();
    expect(buildUserSave(existing, editForm(existing)).patch).toBeNull();
    const renamed = buildUserSave(existing, editForm(existing, { firstName: 'Karin' }));
    expect(renamed.patch).toEqual({ firstName: 'Karin' });
    expect(Object.keys(renamed.patch ?? {})).not.toContain('username');
  });

  it('is not a field the form carries at all', () => {
    expect(Object.keys(accountFormFrom(user()))).not.toContain('username');
  });
});

// ---------------------------------------------------------------------------
// I1 vs I2 — a hierarchy and a set are different controls
// ---------------------------------------------------------------------------

describe('tier (I1, a hierarchy)', () => {
  it('offers one pick, in the ladder`s own order', () => {
    expect(tierChoices('edit').map((choice) => choice.value)).toEqual([...TIERS]);
  });

  it('leaves ADMIN out of a create, because cap 1 does', () => {
    // "Admin creates/deletes NON-ADMIN accounts" — an admin account is reached by
    // raising an existing one, and `services/user.ts` answers 403 otherwise.
    expect(tierChoices('create').map((choice) => choice.value)).toEqual(['VOLUNTEER', 'STAFF']);
    expect(tierChoices('create').some((choice) => choice.value === 'ADMIN')).toBe(false);
  });
});

describe('duties (I2, set membership)', () => {
  it('toggles each independently — holding one implies nothing about another', () => {
    expect(toggleDuty([], 'RECEIVE')).toEqual(['RECEIVE']);
    expect(toggleDuty(['RECEIVE'], 'DRIVE')).toEqual(['DRIVE', 'RECEIVE']);
    expect(toggleDuty(['DRIVE', 'RECEIVE'], 'RECEIVE')).toEqual(['DRIVE']);
  });

  it('allows none and allows all three', () => {
    let held: Duty[] = [];
    for (const duty of DUTIES) held = toggleDuty(held, duty);
    expect(held).toEqual([...DUTIES]);
    for (const duty of DUTIES) held = toggleDuty(held, duty);
    expect(held).toEqual([]);
  });

  it('keeps a stable order so the row never reshuffles', () => {
    expect(toggleDuty(['REPORT'], 'DRIVE')).toEqual(['DRIVE', 'REPORT']);
  });

  it('compares as a set, not as a list', () => {
    expect(sameDuties(['DRIVE', 'REPORT'], ['REPORT', 'DRIVE'])).toBe(true);
    expect(sameDuties(['DRIVE'], ['DRIVE', 'REPORT'])).toBe(false);
  });

  it('a duty change is sent as the whole set', () => {
    const existing = user({ duties: ['DRIVE'] });
    const plan = buildUserSave(existing, editForm(existing, { duties: ['DRIVE', 'REPORT'] }));
    expect(plan.patch).toEqual({ duties: ['DRIVE', 'REPORT'] });
  });

  it('a reordered set is not a change at all', () => {
    const existing = user({ duties: ['DRIVE', 'REPORT'] });
    const plan = buildUserSave(existing, editForm(existing, { duties: ['REPORT', 'DRIVE'] }));
    expect(isNoOp(plan)).toBe(true);
  });

  it('dropping every duty is a change, and sends the empty set', () => {
    const existing = user({ duties: ['DRIVE'] });
    const plan = buildUserSave(existing, editForm(existing, { duties: [] }));
    expect(plan.patch).toEqual({ duties: [] });
  });
});

describe('the row subtitle', () => {
  it('names the tier and the duties held', () => {
    expect(accountSubtitle(user({ tier: 'STAFF', duties: ['REPORT', 'DRIVE'] }))).toBe(
      'Staff · Drive, Report',
    );
  });

  it('says so plainly when there are none', () => {
    expect(accountSubtitle(user({ duties: [] }))).toBe('Volunteer · no duties yet');
  });

  it('never shows the username as the person`s name (§1 principle 4)', () => {
    expect(fullName(user())).toBe('Karen Smith');
  });
});

// ---------------------------------------------------------------------------
// Credentials — derived from tier, never asked about (`architecture.md §4.2`)
// ---------------------------------------------------------------------------

describe('the credential field', () => {
  it('follows the tier rather than being a choice', () => {
    expect(credentialPlan('create', 'VOLUNTEER', null).kind).toBe('PIN');
    expect(credentialPlan('create', 'STAFF', null).kind).toBe('PASSWORD');
    expect(credentialPlan('edit', 'ADMIN', user()).kind).toBe('PASSWORD');
    for (const tier of TIERS) {
      expect(credentialPlan('edit', tier, user()).kind).toBe(credentialKindFor(tier));
    }
  });

  it('is optional for a new volunteer, because §4.2 defaults the PIN', () => {
    expect(credentialPlan('create', 'VOLUNTEER', null).required).toBe(false);
  });

  it('is required for new staff, because a password has nothing to default from', () => {
    expect(credentialPlan('create', 'STAFF', null).required).toBe(true);
  });

  it('is optional on an ordinary edit — blank keeps what they have', () => {
    expect(credentialPlan('edit', 'VOLUNTEER', user({ tier: 'VOLUNTEER' })).required).toBe(false);
    expect(credentialPlan('edit', 'ADMIN', user({ tier: 'STAFF' })).required).toBe(false);
  });

  it('is required when the tier change crosses the PIN/password line', () => {
    const promoted = credentialPlan('edit', 'STAFF', user({ tier: 'VOLUNTEER' }));
    expect(promoted.required).toBe(true);
    expect(promoted.reason).toBe(COPY.credential.reasonToPassword);

    const demoted = credentialPlan('edit', 'VOLUNTEER', user({ tier: 'ADMIN' }));
    expect(demoted.required).toBe(true);
    expect(demoted.reason).toBe(COPY.credential.reasonToPin);
  });

  it('knows which tier moves cross that line', () => {
    expect(crossesCredentialBoundary('VOLUNTEER', 'STAFF')).toBe(true);
    expect(crossesCredentialBoundary('VOLUNTEER', 'ADMIN')).toBe(true);
    // Staff and Admin both use a password, so this move needs no new credential.
    expect(crossesCredentialBoundary('STAFF', 'ADMIN')).toBe(false);
    expect(crossesCredentialBoundary('ADMIN', 'STAFF')).toBe(false);
  });
});

describe('validation (communication only — the server rules again)', () => {
  it('wants both names', () => {
    const errors = validateAccount(form({ firstName: '  ', lastName: '' }), plan('create'));
    expect(errors['firstName']).toBe(COPY.requiredFirstName);
    expect(errors['lastName']).toBe(COPY.requiredLastName);
    expect(isValid(errors)).toBe(false);
  });

  it('accepts a volunteer with no PIN typed', () => {
    expect(isValid(validateAccount(form(), plan('create')))).toBe(true);
  });

  it('holds a PIN to exactly four digits', () => {
    expect(validateAccount(form({ credential: '123' }), plan('create'))['credential']).toBe(
      COPY.credential.badPin,
    );
    expect(validateAccount(form({ credential: '12345' }), plan('create'))['credential']).toBe(
      COPY.credential.badPin,
    );
    expect(validateAccount(form({ credential: '12a4' }), plan('create'))['credential']).toBe(
      COPY.credential.badPin,
    );
    expect(isValid(validateAccount(form({ credential: '1234' }), plan('create')))).toBe(true);
    expect('1234'.length).toBe(PIN_LENGTH);
  });

  it('holds a password to §4.2`s floor', () => {
    const staff = credentialPlan('create', 'STAFF', null);
    expect(
      validateAccount(form({ tier: 'STAFF', credential: 'short' }), staff)['credential'],
    ).toBe(COPY.credential.badPassword);
    expect(validateAccount(form({ tier: 'STAFF', credential: '' }), staff)['credential']).toBe(
      COPY.credential.missingPassword,
    );
    expect(
      isValid(validateAccount(form({ tier: 'STAFF', credential: 'longenough' }), staff)),
    ).toBe(true);
  });

  function plan(mode: 'create' | 'edit', tier: Tier = 'VOLUNTEER') {
    return credentialPlan(mode, tier, mode === 'edit' ? user() : null);
  }
});

// ---------------------------------------------------------------------------
// What a create and an edit send
// ---------------------------------------------------------------------------

describe('the create body', () => {
  it('trims, clears empty PII to null, and never sends a username', () => {
    const body = buildCreateBody(
      form({ firstName: ' Karen ', lastName: ' Smith ', phone: '  ', address: ' 12 Elm St ' }),
    );
    expect(body).toEqual({
      firstName: 'Karen',
      lastName: 'Smith',
      tier: 'VOLUNTEER',
      duties: [],
      phone: null,
      address: '12 Elm St',
    });
    expect(Object.keys(body)).not.toContain('username');
  });

  it('omits the credential entirely when none was typed', () => {
    expect(buildCreateBody(form())).not.toHaveProperty('credential');
    expect(buildCreateBody(form({ credential: '1234' })).credential).toBe('1234');
  });
});

describe('the edit plan', () => {
  it('sends only what changed', () => {
    const existing = user();
    const plan = buildUserSave(existing, editForm(existing, { lastName: 'Smyth' }));
    expect(plan.patch).toEqual({ lastName: 'Smyth' });
  });

  it('sends nothing at all when nothing changed', () => {
    const existing = user();
    const plan = buildUserSave(existing, accountFormFrom(existing));
    expect(isNoOp(plan)).toBe(true);
  });

  it('clears a phone to null rather than to an empty string', () => {
    const existing = user({ phone: '555-1234' });
    const plan = buildUserSave(existing, editForm(existing, { phone: '   ' }));
    expect(plan.patch).toEqual({ phone: null });
  });

  it('carries a new credential inside the patch when anything else changed', () => {
    // One request, so a tier change and its required new password cannot
    // half-apply.
    const existing = user({ tier: 'VOLUNTEER' });
    const plan = buildUserSave(
      existing,
      editForm(existing, { tier: 'STAFF', credential: 'longenough' }),
    );
    expect(plan.patch).toEqual({ tier: 'STAFF', credential: 'longenough' });
    expect(plan.credentialOnly).toBeNull();
  });

  it('uses the dedicated reset route when the credential is the only change', () => {
    const existing = user();
    const plan = buildUserSave(existing, editForm(existing, { credential: '4821' }));
    expect(plan.patch).toBeNull();
    expect(plan.credentialOnly).toBe('4821');
  });

  it('never carries `active`, so an ordinary save cannot reactivate by accident', () => {
    // §3.3's return arrow is its own deliberate action with its own button. Saving
    // a field edit on a deactivated account leaves it deactivated — I21 says the
    // details of a deactivated account stay editable, which is a different thing
    // from bringing it back.
    const existing = user({ active: false });
    const plan = buildUserSave(existing, editForm(existing, { lastName: 'Smyth' }));
    expect(plan.patch).toEqual({ lastName: 'Smyth' });
    expect(plan.patch).not.toHaveProperty('active');
  });

  it('treats an absent phone the same as a null one', () => {
    // `pii.ts` deletes the field when the viewer may not see it; an admin always
    // may, so absent here means genuinely unset and clearing it is not a change.
    const existing = user();
    delete existing.phone;
    const plan = buildUserSave(existing, editForm(existing));
    expect(plan.patch).toBeNull();
  });
});

describe('what to say about a new account`s PIN', () => {
  it('shows the generated one once, and says to write it down', () => {
    const text = createdNotice('Karen Smith', form(), '4821');
    expect(text).toContain('4821');
    expect(text).toContain(COPY.pinNotice.writeItDown);
  });

  it('points at the phone when that is where the PIN came from', () => {
    expect(createdNotice('Karen Smith', form({ phone: '555-867-5309' }), undefined)).toBe(
      'Karen Smith signs in with the last 4 digits of their phone.',
    );
  });

  it('says nothing when the admin typed the credential themselves', () => {
    expect(createdNotice('Karen Smith', form({ credential: '1234' }), undefined)).toBeNull();
    expect(
      createdNotice('Clark Kent', form({ tier: 'STAFF', credential: 'longenough' }), undefined),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// I21 — removal reports which branch ran, and never asks
// ---------------------------------------------------------------------------

describe('removal (I21)', () => {
  it('names the consequence without predicting the branch', () => {
    // The confirm may not say "this will be archived" or "this will be deleted":
    // the domain decides, and the admin is not offered the choice.
    expect(COPY.confirm.consequence).toContain('keeps it');
    expect(COPY.confirm.consequence).toContain('deletes it');
    expect(COPY.confirm.consequence).toContain("You'll see which happened");
  });

  it('has exactly one confirm label — not one per branch', () => {
    expect(COPY.confirm.label).toBe('Remove');
  });

  it('reports a hard delete as gone', () => {
    expect(removalText('user', 'Karen Smith', 'DELETED')).toBe(
      "Karen Smith's account is gone. Nothing in R3 pointed at it.",
    );
    expect(removalText('donor', 'Kroger', 'DELETED')).toContain('is gone');
    expect(removalText('category', 'Produce', 'DELETED')).toContain('had been weighed');
  });

  it('reports a soft delete as kept, per entity', () => {
    expect(removalText('user', 'Karen Smith', 'DEACTIVATED')).toContain('history are kept');
    expect(removalText('donor', 'Kroger', 'DEACTIVATED')).toContain('Past runs still show it');
    expect(removalText('truck', 'Truck 2', 'DEACTIVATED')).toContain('Past runs still show it');
    // The archived category stays out of new weighing and keeps resolving in
    // reports — S1.8's own reason for the soft branch.
    expect(removalText('category', 'Produce', 'DEACTIVATED')).toContain('reports still do');
  });

  it('never says a soft-deleted record was destroyed', () => {
    for (const entity of ['user', 'donor', 'truck', 'category'] as const) {
      expect(removalText(entity, 'X', 'DEACTIVATED')).not.toContain('gone');
    }
  });

  it('uses the word §3.3 gives each entity for out-of-use', () => {
    expect(inactiveLabel('user')).toBe('Deactivated');
    expect(inactiveLabel('donor')).toBe('Deactivated');
    expect(inactiveLabel('truck')).toBe('Inactive');
    expect(inactiveLabel('category')).toBe('Archived');
  });

  it('offers the lifecycle toggle as two states, which is a field edit not a removal', () => {
    expect(statusChoices('category').map((choice) => choice.label)).toEqual([
      'In use',
      'Archived',
    ]);
  });
});

// ---------------------------------------------------------------------------
// The three master lists
// ---------------------------------------------------------------------------

describe('master records', () => {
  it('start with every field blank', () => {
    expect(emptyMasterValues([{ key: 'name', label: 'Name' }])).toEqual({ name: '' });
  });

  it('require the fields marked required and nothing else', () => {
    const fields = [
      { key: 'name', label: 'Name', required: true },
      { key: 'plate', label: 'Plate' },
    ];
    expect(validateMaster(fields, { name: '  ', plate: '' })['name']).toBe(COPY.requiredName);
    expect(isValid(validateMaster(fields, { name: 'Truck 2', plate: '' }))).toBe(true);
  });

  it('trim a required value and clear an optional one to null', () => {
    expect(trimmedValue({ name: '  Kroger  ' }, 'name')).toBe('Kroger');
    expect(nullableValue({ plate: '   ' }, 'plate')).toBeNull();
    expect(nullableValue({ plate: ' ABC 123 ' }, 'plate')).toBe('ABC 123');
    expect(nullableValue({}, 'missing')).toBeNull();
  });

  it('gives each list exactly one required name field', () => {
    for (const config of MASTER_CONFIGS) {
      const required = config.fields.filter((field) => field.required === true);
      expect(required).toHaveLength(1);
    }
  });

  it('keeps the donor address and contact as ordinary fields', () => {
    // PII gates people, not places: a donor's address is where the driver is
    // going, and trimming it would break the driver's screens.
    const donor = MASTER_CONFIGS.find((config) => config.entity === 'donor');
    expect(donor?.fields.map((field) => field.key)).toEqual([
      'name',
      'address',
      'contact',
      'note',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Microcopy (§7)
// ---------------------------------------------------------------------------

describe('the copy', () => {
  /** Every sentence this screen can show, flattened. */
  function everyString(value: unknown): string[] {
    if (typeof value === 'string') return [value];
    if (Array.isArray(value)) return value.flatMap(everyString);
    if (value !== null && typeof value === 'object') {
      return Object.values(value).flatMap(everyString);
    }
    return [];
  }

  const strings = [
    ...everyString(COPY),
    ...MASTER_CONFIGS.flatMap((config) => [
      config.heading,
      config.addLabel,
      config.createTitle,
      config.editTitle,
      config.emptyTitle,
      config.emptyBody,
      config.loadingLabel,
      ...config.fields.flatMap((field) => [field.label, field.hint ?? '']),
    ]),
    ...(['user', 'donor', 'truck', 'category'] as const).flatMap((entity) => [
      removalText(entity, 'X', 'DELETED'),
      removalText(entity, 'X', 'DEACTIVATED'),
    ]),
    createdNotice('X', { ...EMPTY_ACCOUNT_FORM }, '4821') ?? '',
    createdNotice('X', { ...EMPTY_ACCOUNT_FORM, phone: '555' }, undefined) ?? '',
  ];

  it('uses none of §7`s forbidden vocabulary', () => {
    // "instance" is on the list, so `instances` and `instance` both fail. The
    // regex is word-boundaried to keep "endpoint" from matching nothing at all.
    const forbidden = [
      /\bPWA\b/i,
      /\bpush subscription/i,
      /\bsessions?\b/i,
      /\bpayloads?\b/i,
      /\bendpoints?\b/i,
      /\batomic/i,
      /\binstances?\b/i,
    ];
    for (const text of strings) {
      for (const pattern of forbidden) {
        expect(text, `forbidden word in: ${text}`).not.toMatch(pattern);
      }
    }
  });

  it('avoids the schema`s own vocabulary in what a person reads', () => {
    // The wire says DEACTIVATED / soft-delete / tier; a human reads none of that.
    for (const text of strings) {
      expect(text, text).not.toMatch(/soft.?delet/i);
      expect(text, text).not.toMatch(/\bapp_user\b/);
      expect(text, text).not.toMatch(/\bI\d+\b/);
    }
  });

  it('says something in every empty state (§6: instructive, never `nothing here`)', () => {
    for (const config of MASTER_CONFIGS) {
      expect(config.emptyTitle.length).toBeGreaterThan(0);
      expect(config.emptyBody.length).toBeGreaterThan(0);
    }
    expect(COPY.accounts.emptyBody.length).toBeGreaterThan(0);
  });
});
