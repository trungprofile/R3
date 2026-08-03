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
  DEFAULT_PANEL,
  EMPTY_ACCOUNT_FORM,
  emptyMasterValues,
  fieldKind,
  fullName,
  hintForField,
  inactiveLabel,
  isNoOp,
  isValid,
  normalizeNamePart,
  nullableValue,
  PANELS,
  panelFromQuery,
  RETIRED_PANELS,
  percentError,
  percentFromRate,
  photoChange,
  rateFromPercent,
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
import { CATEGORY_CONFIG, DONOR_CONFIG, MASTER_CONFIGS, TRUCK_CONFIG } from './masters.ts';
// D40 — the matching's words stayed in its own module and are read from there,
// which is what this test is holding the merge to.
import { COPY as MAPPING_COPY } from './mapping/mapping.ts';
import { scaledSize } from './photo.ts';

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
// The sub-screens (S1.8 Layout, plus D18 and D12)
// ---------------------------------------------------------------------------

describe('the admin shell', () => {
  it('has the four sub-screens S1.8 names, plus the one that joined them', () => {
    // S1.8's own four, in S1.8's own order, are still contiguous and still in it.
    // Metrics (D18) leads because it is the read an admin opens without a record
    // in mind. Category matching (D17) trailed Categories for one round and D40
    // merged it INTO Categories, because sitting beside it still meant an admin
    // configured a category on one tab and said where it reports on another.
    expect(PANELS.map((panel) => panel.value)).toEqual([
      'metrics',
      'accounts',
      'donors',
      'trucks',
      'categories',
    ]);
    expect(PANELS.map((panel) => panel.label)).toEqual([
      'Metrics',
      'Accounts',
      'Donors',
      'Trucks',
      'Categories',
    ]);
  });

  it('keeps `?tab=mapping` resolving, to the tab that absorbed it (D40)', () => {
    // The same courtesy D18 gave `/metrics`. Landing on the default would be
    // silently wrong: the admin asked for the matching and would get Metrics.
    expect(panelFromQuery('mapping')).toBe('categories');
    expect(RETIRED_PANELS['mapping']).toBe('categories');
    // An unknown tab is still the default rather than an error.
    expect(panelFromQuery('nonsense')).toBe(DEFAULT_PANEL);
    expect(panelFromQuery(undefined)).toBe(DEFAULT_PANEL);
  });

  it('opens on Metrics when the URL names no tab (D18)', () => {
    expect(DEFAULT_PANEL).toBe('metrics');
    expect(panelFromQuery(undefined)).toBe('metrics');
    expect(panelFromQuery('')).toBe('metrics');
  });

  it('opens the tab a link names', () => {
    for (const panel of PANELS) expect(panelFromQuery(panel.value)).toBe(panel.value);
  });

  it('lands somewhere useful when a link names a tab that does not exist', () => {
    // A bookmark from before a rename should not be a dead screen.
    expect(panelFromQuery('nonsense')).toBe(DEFAULT_PANEL);
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
    // going, and trimming it would break the driver's screens. The map link is
    // the same kind of thing (D20) and is not PII either.
    const donor = MASTER_CONFIGS.find((config) => config.entity === 'donor');
    expect(donor?.fields.map((field) => field.key)).toEqual([
      'name',
      'address',
      'mapUrl',
      'contact',
      'note',
      'photo',
      // D27 gave the store form the food bank's own number for the store, which
      // until this round had NO write path anywhere in the app, and the three
      // trash rates the printed receipt deducts by.
      'ntfbDonorCode',
      'trashRateBakery',
      'trashRateProduce',
      'trashRateDeli',
    ]);
  });

  it('treats a field with no kind as text, so every other field is unchanged', () => {
    // Two fields in the whole app declare a kind: the donor photo (D20) and the
    // category's food bank target (D40). Everything else is text, and stays text
    // by omission rather than by being spelled out config by config.
    for (const config of MASTER_CONFIGS) {
      for (const field of config.fields) {
        if (field.key === 'photo') expect(fieldKind(field)).toBe('image');
        else if (field.key === 'ntfbCategoryId') expect(fieldKind(field)).toBe('choice');
        else expect(fieldKind(field), field.key).toBe('text');
      }
    }
  });

  it('puts the food bank target and its storage on the category editor (D40)', () => {
    // The merge, asserted where it is cheapest to break: an admin adding a
    // category used to fill in a name, save, change tab, find the same category
    // again and only then say where it reports. Two of those steps existed
    // because the controls were on two tabs.
    expect(CATEGORY_CONFIG.fields.map((field) => field.key)).toEqual([
      'name',
      'ntfbCategoryId',
      'storage',
    ]);

    // The target's options come from what the panel LOADED, not from a constant:
    // an admin can archive a food bank category in the section directly below the
    // form, and a live category pointed at an archived bucket would be the next
    // blocked export built by hand (D12).
    const target = CATEGORY_CONFIG.fields.find((field) => field.key === 'ntfbCategoryId')!;
    const options = target.options!({
      ntfbCategories: [
        { id: 'n1', name: 'Produce', code: '14', active: true, mappedCount: 1 },
        { id: 'n2', name: 'Retired', code: null, active: false, mappedCount: 0 },
      ],
    });
    expect(options.map((option) => option.value)).toEqual(['n1', '']);
    expect(options[0]!.label).toBe('Produce (14)');
    // "Leave it unmatched" is an OPTION, not the absence of one: it is a real
    // answer, and a control that expressed it as "nothing selected" could not tell
    // an admin who meant it from one who has not got to it yet.
    expect(options[1]!.label).toBe(MAPPING_COPY.leaveUnmatched);
  });

  it('loads the food bank list only where a field needs it', () => {
    // Categories is the one config with a choice field. Donors and trucks fetch
    // nothing extra, so a tab switch is not a request for an empty object.
    expect(CATEGORY_CONFIG.loadContext).toBeTypeOf('function');
    expect(DONOR_CONFIG.loadContext).toBeUndefined();
    expect(TRUCK_CONFIG.loadContext).toBeUndefined();
  });

  it('gives donors the only image field, and does not make it required', () => {
    // A store without a photo is the ordinary case, not an incomplete record.
    const image = MASTER_CONFIGS.flatMap((config) =>
      config.fields.filter((field) => fieldKind(field) === 'image'),
    );
    expect(image).toHaveLength(1);
    expect(image[0]?.required).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Trash rates — a percentage on screen, a decimal fraction on the wire (D27)
//
// The one screen in R3 where a number silently changes what the food bank is
// told. Three things have to hold, and the first is the one that would go wrong
// quietly: BLANK IS NOT ZERO. Blank means "use the pantry default"; 0 means this
// store genuinely wastes nothing. A blank that saved as 0 would stop a store's
// produce ever being deducted and nothing on any screen would say so.
// ---------------------------------------------------------------------------

describe('a store`s trash rate', () => {
  it('shows the wire`s fraction as the percentage a person recognises', () => {
    expect(percentFromRate('0.1000')).toBe('10');
    expect(percentFromRate('0.0500')).toBe('5');
    expect(percentFromRate('0.1500')).toBe('15');
    expect(percentFromRate('1.0000')).toBe('100');
    expect(percentFromRate('0.1234')).toBe('12.34');
  });

  it('sends the percentage as the decimal fraction numeric(5,4) holds', () => {
    expect(rateFromPercent('10')).toBe('0.1000');
    expect(rateFromPercent('5')).toBe('0.0500');
    expect(rateFromPercent('15')).toBe('0.1500');
    expect(rateFromPercent('100')).toBe('1.0000');
    expect(rateFromPercent('12.5')).toBe('0.1250');
    expect(rateFromPercent('0.5')).toBe('0.0050');
  });

  it('never divides in a float', () => {
    // `10 / 100` is not reliably `0.1`, and `numeric(5,4)` is exact. Both
    // directions are string surgery: the decimal point moves, nothing is
    // computed. The proof is that every value round-trips unchanged.
    for (const percent of ['0', '5', '10', '12.5', '15', '33.33', '100']) {
      expect(percentFromRate(rateFromPercent(percent)), percent).toBe(percent);
    }
  });

  it('keeps blank and zero apart, in both directions', () => {
    // The distinction the nullable column exists for. `null` is "use the pantry
    // default"; `0.0000` is "this store wastes nothing".
    expect(percentFromRate(null)).toBe('');
    expect(percentFromRate('0.0000')).toBe('0');
    expect(rateFromPercent('')).toBeNull();
    expect(rateFromPercent('   ')).toBeNull();
    expect(rateFromPercent('0')).toBe('0.0000');
  });

  it('round-trips a blank as a blank and a zero as a zero', () => {
    expect(rateFromPercent(percentFromRate(null))).toBeNull();
    expect(rateFromPercent(percentFromRate('0.0000'))).toBe('0.0000');
    expect(percentFromRate(rateFromPercent('0') ?? '')).toBe('0');
  });

  it('leaves a figure it cannot read alone rather than guessing one', () => {
    // Turning a typo into `null` would file it as "use the default" and say
    // nothing; sending it on gets the server's own refusal instead.
    expect(percentFromRate('nonsense')).toBe('nonsense');
    expect(rateFromPercent('ten')).toBe('ten');
  });

  it('says what is wrong before the round trip, and allows a blank', () => {
    // Communication only: `ck_donor_trash_rates` is the rule and refuses the same
    // values again.
    expect(percentError('')).toBeNull();
    expect(percentError('10')).toBeNull();
    expect(percentError('0')).toBeNull();
    expect(percentError('100')).toBeNull();
    expect(percentError('101')).toBe(COPY.rates.outOfRange);
    expect(percentError('ten')).toBe(COPY.rates.badNumber);
    expect(percentError('-5')).toBe(COPY.rates.badNumber);
    expect(percentError('10.123')).toBe(COPY.rates.badNumber);
  });

  it('refuses to save a rate the server would refuse', () => {
    const donor = MASTER_CONFIGS.find((config) => config.entity === 'donor')!;
    const values = { name: 'Sam’s Club', trashRateProduce: '150' };
    expect(validateMaster(donor.fields, values)['trashRateProduce']).toBe(
      COPY.rates.outOfRange,
    );
    expect(isValid(validateMaster(donor.fields, { name: 'Sam’s Club' }))).toBe(true);
  });

  it('shows a blank field what it will actually use', () => {
    // A blank control decides something, and an admin cannot see what from a
    // control that is showing nothing.
    const donor = MASTER_CONFIGS.find((config) => config.entity === 'donor')!;
    const bakery = donor.fields.find((field) => field.key === 'trashRateBakery')!;
    const produce = donor.fields.find((field) => field.key === 'trashRateProduce')!;

    expect(hintForField(bakery, '')).toContain('10%');
    expect(hintForField(produce, '')).toContain('5%');
    // An explicit 0 reads as the decision it is, never as an empty field.
    expect(hintForField(bakery, '0')).toBe(COPY.rates.explicitZero);
    // A rate the admin typed needs no hint: the number is right there.
    expect(hintForField(bakery, '10')).toBeUndefined();
  });

  it('says what the rate does once, over the group rather than on each field', () => {
    // Three fields, one sentence: repeating it would be exactly the D21 cut.
    const donor = MASTER_CONFIGS.find((config) => config.entity === 'donor')!;
    const rates = donor.fields.filter((field) => field.key.startsWith('trashRate'));
    expect(rates).toHaveLength(3);
    expect(rates.filter((field) => field.section !== undefined)).toHaveLength(1);
    expect(rates[0]?.section?.body.toLowerCase()).toContain('trash');
  });
});

// ---------------------------------------------------------------------------
// The donor photo (D20)
// ---------------------------------------------------------------------------

describe('an image field`s value', () => {
  const STORED = '/api/donors/d1/photo';
  const CHOSEN = 'data:image/jpeg;base64,abc';

  it('sends nothing when the photo was not touched', () => {
    expect(photoChange(STORED, STORED)).toEqual({ kind: 'none' });
    // A donor that never had one, saved without adding one, must not fire a
    // pointless clear on every edit.
    expect(photoChange('', '')).toEqual({ kind: 'none' });
  });

  it('sends the new bytes when one was chosen', () => {
    expect(photoChange('', CHOSEN)).toEqual({ kind: 'set', dataUrl: CHOSEN });
    expect(photoChange(STORED, CHOSEN)).toEqual({ kind: 'set', dataUrl: CHOSEN });
  });

  it('clears only when there was one to clear', () => {
    expect(photoChange(STORED, '')).toEqual({ kind: 'clear' });
    expect(photoChange('', '')).not.toEqual({ kind: 'clear' });
  });

  it('sends nothing when a chosen photo is abandoned for the stored one', () => {
    expect(photoChange(STORED, STORED)).toEqual({ kind: 'none' });
  });
});

describe('resizing before upload (D20)', () => {
  // The server's ~400 KB CHECK is the backstop; this is what keeps a phone photo
  // from ever reaching it. Only the arithmetic is testable here — the canvas
  // itself needs a DOM, and this suite has none.
  it('fits the long edge, whichever edge that is', () => {
    expect(scaledSize(4000, 3000)).toEqual({ width: 800, height: 600 });
    expect(scaledSize(3000, 4000)).toEqual({ width: 600, height: 800 });
  });

  it('never enlarges a photo that is already small', () => {
    expect(scaledSize(320, 240)).toEqual({ width: 320, height: 240 });
    expect(scaledSize(800, 800)).toEqual({ width: 800, height: 800 });
  });

  it('keeps a sliver of an image rather than rounding an edge to zero', () => {
    expect(scaledSize(4000, 3).height).toBeGreaterThanOrEqual(1);
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
      ...config.fields.flatMap((field) => [
        field.label,
        field.hint ?? '',
        field.section?.title ?? '',
        field.section?.body ?? '',
        // A hint composed from data is where a forbidden word arrives without
        // anyone typing it into `COPY` (D27's "Blank uses the pantry default,
        // 10%." is built, not written).
        hintForField(field, '') ?? '',
        hintForField(field, '0') ?? '',
      ]),
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

  it('uses no em dash in anything a person reads (D21)', () => {
    // It renders as a hyphen at 18px on a cab-mounted screen, so a sentence that
    // leaned on one became two sentences or took a comma. The empty-value glyph in
    // `parts.tsx` is a mark rather than prose and is not in this set.
    for (const text of strings) expect(text, text).not.toContain('—');
  });

  it('keeps the hints that say something the screen cannot (D21)', () => {
    // The cut was of hints that restated the control under them. These two are the
    // opposite: a ladder is invisible in a row of three buttons, and the PIN
    // default is knowable nowhere else.
    expect(COPY.accounts.tierHint).toContain('includes the one before it');
    expect(COPY.credential.pinHintCreate).toContain('last 4 digits');
    expect(COPY.credential.pinHintEdit).toContain('keep the PIN');
  });

  it('says something in every empty state (§6: instructive, never `nothing here`)', () => {
    for (const config of MASTER_CONFIGS) {
      expect(config.emptyTitle.length).toBeGreaterThan(0);
      expect(config.emptyBody.length).toBeGreaterThan(0);
    }
    expect(COPY.accounts.emptyBody.length).toBeGreaterThan(0);
  });
});
