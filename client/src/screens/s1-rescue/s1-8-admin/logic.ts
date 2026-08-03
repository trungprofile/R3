// S1.8 Admin — the decisions and the copy, apart from the rendering.
//
// PURE ON PURPOSE, the same shape as S1.1's `login.ts`: nothing here touches
// `window`, React or the network. There is no browser or component test harness in
// this repo and adding one would be a dependency a lane may not add (build-plan
// §3/D5), so everything on this screen that is a RULE rather than a pixel lives
// here and is covered by `admin.test.ts`.
//
// This screen renders three invariants more directly than any other in Phase 1,
// and the three are different KINDS of thing, which is the trap:
//
//   I1  tier      — a hierarchy. ONE pick from Volunteer / Staff / Admin.
//   I2  duties    — set membership. Independent toggles; holding one implies
//                   nothing about another.
//   I3  username  — generated, and immutable after creation. Shown, never typed.
//
// And one more that shapes the copy rather than a control: I21 removal decides
// itself. The admin presses one Remove; the server answers which of hard-delete or
// deactivate happened, and this file only has to say so in a sentence.

import { toApiError } from '../../../api/index.ts';
import {
  credentialKindFor,
  DUTIES,
  MIN_PASSWORD_LENGTH,
  PIN_LENGTH,
  TIERS,
} from '../../../api/shared.ts';
import type {
  CredentialKind,
  Duty,
  RemovalOutcome,
  ShapedUser,
  Tier,
  UpdateUserRequest,
} from '../../../api/shared.ts';

// ---------------------------------------------------------------------------
// The sub-screens (S1.8 Layout)
//
// S1.8 names four — "Accounts, Donors, Trucks, Categories — selected by the §3
// segmented control in its tabs behavior". The list went to six and is back to
// five, and both moves are worth having written down:
//
//   Metrics (D18)           — S3.2, which was its own route and its own left-nav
//                             entry. It is a READ about the same records the other
//                             tabs edit, and an admin opens R3 either to see how
//                             the week went or to fix a record; one click apart
//                             beats two places.
//   Category matching (D17) — the NTFB category map, added beside Categories as
//                             category master data by another name.
//   ...and RETIRED by D40   — because "beside" was the wrong answer. An admin
//                             configuring a category had to finish, change tab,
//                             find the same category again and say where it
//                             reports. The two halves are now ONE tab: our
//                             categories with their food bank target inline on
//                             each row's editor, and the food bank's own list as
//                             a reference section under them.
//
// `?tab=mapping` still resolves, as a redirect to the merged tab — the same
// courtesy D18 gave `/metrics`. §1 principle 5 still rules out hiding any of these
// behind a dropdown, so all five stay visible in the tab row.
// ---------------------------------------------------------------------------

export type PanelId =
  | 'metrics'
  | 'accounts'
  | 'donors'
  | 'trucks'
  | 'categories';

export const PANELS: readonly { value: PanelId; label: string }[] = [
  { value: 'metrics', label: 'Metrics' },
  { value: 'accounts', label: 'Accounts' },
  { value: 'donors', label: 'Donors' },
  { value: 'trucks', label: 'Trucks' },
  { value: 'categories', label: 'Categories' },
];

/** What `/admin` shows when the URL names no tab. D18 puts the read first: it is
 *  the tab an admin opens without a specific record in mind. */
export const DEFAULT_PANEL: PanelId = 'metrics';

/**
 * Tabs that no longer exist, and where they went (D40).
 *
 * `?tab=mapping` was a real tab from D17 until D40 merged it into Categories, and
 * a link to it is the kind of thing that gets pasted into a message and read a
 * week later. Landing on the default would be silently wrong — the admin asked for
 * the matching and would get Metrics — so it resolves to the tab that absorbed it,
 * which is where the matching actually is.
 */
export const RETIRED_PANELS: Readonly<Record<string, PanelId>> = {
  mapping: 'categories',
};

/** The query key the tab lives under, so a tab is a link someone can send.
 *  `?tab=` rather than a path segment: `ROUTES` stays a flat list of real paths
 *  instead of every screen's pattern growing an optional tail (`app/router.tsx`). */
export const PANEL_QUERY_KEY = 'tab';

/** Which panel a URL asks for. A retired name lands on the tab that absorbed it;
 *  an unknown or absent one is the default rather than an error, because a stale
 *  bookmark should land somewhere useful and not on a 404. */
export function panelFromQuery(value: string | undefined): PanelId {
  const known = PANELS.find((panel) => panel.value === value);
  if (known) return known.value;
  if (value !== undefined && value in RETIRED_PANELS) return RETIRED_PANELS[value]!;
  return DEFAULT_PANEL;
}

/** Which master list a panel edits. Accounts is not one of these: `app_user` is a
 *  person, with a credential and a tier, and none of the master-record machinery
 *  below fits it. */
export type MasterEntity = 'donor' | 'truck' | 'category';

// ---------------------------------------------------------------------------
// Copy (`ui-ux-spec.md` S1.8, §6, §7)
//
// Collected here so one test can hold all of it to §7: plain, short, second
// person, and none of the forbidden vocabulary.
//
// D21 — TWO RULES this block was pruned against, and both are testable:
//
//   1. A hint that only restates the control under it is deleted. "Fill in the
//      name and R3 makes one" sat under a field that fills in as the name is
//      typed; it told a reader what they were already watching happen. What
//      survives is what the screen cannot otherwise show: the tier ladder, and
//      the PIN default an admin has no way to guess.
//   2. No em dash in anything a person reads. It renders as a hyphen at 18px on a
//      cab-mounted screen, so a sentence that leans on one becomes two sentences
//      or takes a comma — never a hyphen in its place.
// ---------------------------------------------------------------------------

export const COPY = {
  title: 'Admin',
  tabsLabel: 'Metrics, accounts, donors, trucks and categories',

  accounts: {
    heading: 'Accounts',
    add: 'Add someone',
    loading: 'Loading accounts',
    emptyTitle: 'No accounts yet.',
    emptyBody: 'Add the first one. You can set what they do at the same time.',
    createTitle: 'Add someone',
    editTitle: 'Edit account',
    save: 'Save',
    create: 'Add',
    remove: 'Remove account',
    /** Why the Remove button is missing on an admin row (S1.8: "Delete non-admin"). */
    adminNotRemovable: 'An admin account is not removed here.',
    deactivated:
      "This account is deactivated. It can't sign in, and its runs and history are kept.",
    /** §3.3's ACTIVE ⇄ DEACTIVATED return arrow. Says what happens to the sign-in
     *  details, because that is the first thing the admin will be asked. */
    reactivate: 'Bring this account back',
    reactivated: 'Account brought back. They sign in with the same details as before.',
    firstName: 'First name',
    lastName: 'Last name',
    username: 'Username',
    usernameHint: "Made from the name. It can't be changed later.",
    tier: 'What they can reach',
    /** Kept (D21): a hierarchy is not visible in a row of three buttons, and this
     *  is the only place in R3 that says so. */
    tierHint:
      'Each level includes the one before it: staff can do everything a volunteer can, and admin everything staff can.',
    duties: 'What they do',
    dutiesHint:
      'Any mix, and none is required. Drive takes pickup runs, Receive weighs deliveries, Report files the food-bank report.',
    phone: 'Phone',
    address: 'Address',
    savedToast: 'Saved.',
  },

  /** The PIN or password field. Which one it is follows the tier and is never a
   *  choice: `credentialKindFor` (`architecture.md §4.2`). */
  credential: {
    pinLabel: 'Their 4-digit PIN',
    pinKeypad: 'PIN keypad',
    /** Both kept (D21): they state a default the admin has no other way to know. */
    pinHintCreate: 'Leave it blank to use the last 4 digits of their phone.',
    pinHintEdit: 'Leave it blank to keep the PIN they have.',
    passwordLabel: 'Their password',
    passwordHintCreate: `At least ${MIN_PASSWORD_LENGTH} characters. Tell them yourself, because R3 won't show it again.`,
    passwordHintEdit: 'Leave it blank to keep the password they have.',
    /** Shown when a tier change is what makes a new credential necessary. */
    reasonToPassword:
      'Staff and admins sign in with a password, so this account needs one now.',
    reasonToPin: 'Volunteers sign in with a 4-digit PIN, so this account needs one now.',
    missingPin: 'Enter 4 digits.',
    missingPassword: 'Enter a password.',
    badPin: `A PIN is exactly ${PIN_LENGTH} digits.`,
    badPassword: `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
  },

  /** Shown once, on the screen, after a create where R3 picked the PIN itself.
   *  Never a toast on its own: §3 says a toast is never the only signal for
   *  something critical, and this is the only time the PIN is ever visible. */
  pinNotice: {
    dismiss: 'Got it',
    writeItDown: "Write it down. R3 won't show it again.",
  },

  /**
   * D40 — the ONE new sentence the merge needed.
   *
   * Everything else the matching says is still in `mapping/mapping.ts` and is read
   * from there: `remapNotice`, `storageField`, `storageHint`, `leaveUnmatched`,
   * `notMatched`, `storageMissing` and the rest. What moved with D40 is where the
   * controls are DRAWN, not what any of them means, so `masters.ts` imports that
   * copy rather than restating it — a sentence in two places is two sentences to
   * keep in step, and they do not stay in step (§6's own standing lesson).
   */
  mapping: {
    sectionTitle: 'Where this reports to the food bank',
    targetField: 'Food bank category',
  },

  master: {
    save: 'Save',
    create: 'Add',
    remove: 'Remove',
    saved: 'Saved.',
    /** §3.3's ACTIVE ⇄ DEACTIVATED toggle, which is a field edit and not a
     *  removal — I21 allows it whatever the record's history. */
    status: 'In use',
    inUse: 'In use',
  },

  /**
   * D27 — the per-store trash rates, and D21's "keep what the reader cannot see
   * for themselves" at its strongest.
   *
   * This is the one screen in R3 where a number changes what the food bank is
   * told without anyone seeing it happen: a rate typed here quietly moves a share
   * of every future receipt out of Bakery, Produce or Deli and into Trash. So the
   * group says what the number DOES, and each blank field says what the store will
   * actually use, which a blank control cannot show on its own.
   */
  rates: {
    sectionTitle: 'Trash deduction',
    sectionBody:
      'A share of this store’s bakery, produce and deli weight is reported to the food bank as Trash rather than as food. It is worked out, never weighed.',
    /** Prefix for the effective value shown beside a blank field. The number
     *  itself is appended, so the sentence stays one string in one place. */
    usesDefault: 'Blank uses the pantry default,',
    /** Kept apart from `usesDefault` so a store that genuinely wastes nothing
     *  reads as a decision rather than as an empty field. */
    explicitZero: 'Nothing is deducted for this store.',
    badNumber: 'Use a number like 10, or leave it blank.',
    outOfRange: 'Use a number between 0 and 100.',
  },

  /** D20 — the donor photo field. The words are entity-neutral because the field
   *  kind is: only donors have one today, and nothing here says "store". */
  photo: {
    none: 'No photo yet.',
    choose: 'Choose a photo',
    replace: 'Replace the photo',
    remove: 'Remove the photo',
    /** Names the image for a screen reader. The photo is a landmark, not a
     *  decoration, so it is not `alt=""`. */
    alt: 'The photo on file',
    working: 'Getting the photo ready',
    /** §6: what happened, and what to do about it. Never a code. */
    failed: "That file couldn't be read. Try a photo taken on a phone or camera.",
    notAnImage: 'Choose a photo, not another kind of file.',
  },

  /** §6: a destructive confirm names the consequence. It does NOT predict which
   *  branch of I21 will run — that is the domain's answer, not a guess made here,
   *  and offering two buttons would make the admin choose something they must not. */
  confirm: {
    label: 'Remove',
    consequence:
      "R3 keeps it if anything points at it, and deletes it if nothing does. You'll see which happened.",
  },

  requiredName: 'Enter a name.',
  requiredFirstName: 'Enter a first name.',
  requiredLastName: 'Enter a last name.',
} as const;

// ---------------------------------------------------------------------------
// Username (I3, `domain-modeling.md §5.1`)
// ---------------------------------------------------------------------------

/** §5.1: NFKD decompose, strip combining marks, lowercase, keep [a-z0-9].
 *  "O'Brien-Núñez" -> "obriennunez". */
export function normalizeNamePart(part: string): string {
  return part
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * The username the admin sees while typing a name, read-only (S1.8).
 *
 * I3 — the server assigns the real one and it is immutable afterwards; this is a
 * PREVIEW so the field is not empty while the name is being typed. It mirrors
 * `domain-modeling.md §5.1` including the collision suffix, and `taken` is the
 * account list already on screen — which includes deactivated accounts, because
 * §5.1's "taken" does: a handle stays reserved, no reuse, no renumber.
 *
 * It can still differ from what comes back (another admin creating someone in the
 * same minute), which is why the created account's real username is shown after
 * the fact rather than assumed.
 */
export function usernamePreview(
  firstName: string,
  lastName: string,
  taken: readonly string[],
): string {
  const base = normalizeNamePart(firstName) + normalizeNamePart(lastName);
  if (base === '') return '';
  const used = new Set(taken);
  if (!used.has(base)) return base;
  // Collision is resolved on the FINAL assembled string, so the suffix shares the
  // namespace (§5.1): if `johnsmith2` exists, the next John Smith is `johnsmith3`.
  let k = 2;
  while (used.has(`${base}${k}`)) k += 1;
  return `${base}${k}`;
}

// ---------------------------------------------------------------------------
// Tier (I1) and duties (I2)
// ---------------------------------------------------------------------------

export const TIER_LABELS: Record<Tier, string> = {
  VOLUNTEER: 'Volunteer',
  STAFF: 'Staff',
  ADMIN: 'Admin',
};

export const DUTY_LABELS: Record<Duty, string> = {
  DRIVE: 'Drive',
  RECEIVE: 'Receive',
  REPORT: 'Report',
};

/**
 * I1 — one pick from an ordered set, so the control is a segmented row rather
 * than three toggles. Order is `TIERS`' own order (VOLUNTEER ⊂ STAFF ⊂ ADMIN),
 * which is what makes the row read as a ladder.
 *
 * ADMIN is absent when creating: `product-requirement.md` cap 1 gives Admin
 * "creates/deletes NON-ADMIN accounts" while also granting tier assignment, so an
 * admin account is reached by raising an existing one. `services/user.ts` refuses
 * a create at ADMIN with a 403 — this only stops the screen offering a button
 * whose sole outcome is that refusal.
 */
export function tierChoices(mode: FormMode): readonly { value: Tier; label: string }[] {
  const offered = mode === 'create' ? TIERS.filter((tier) => tier !== 'ADMIN') : TIERS;
  return offered.map((tier) => ({ value: tier, label: TIER_LABELS[tier] }));
}

/** I2 — duties are a SET: each is toggled on its own and holding one implies
 *  nothing about another. Order is `DUTIES`' own so the row never reshuffles. */
export function toggleDuty(held: readonly Duty[], duty: Duty): Duty[] {
  const next = held.includes(duty) ? held.filter((each) => each !== duty) : [...held, duty];
  return DUTIES.filter((candidate) => next.includes(candidate));
}

export function sameDuties(a: readonly Duty[], b: readonly Duty[]): boolean {
  return a.length === b.length && a.every((duty) => b.includes(duty));
}

/** The row's second line: tier, then the duties held, never a made-up role name. */
export function accountSubtitle(user: ShapedUser): string {
  const duties = DUTIES.filter((duty) => user.duties.includes(duty)).map(
    (duty) => DUTY_LABELS[duty],
  );
  return duties.length === 0
    ? `${TIER_LABELS[user.tier]} · no duties yet`
    : `${TIER_LABELS[user.tier]} · ${duties.join(', ')}`;
}

export function fullName(user: Pick<ShapedUser, 'firstName' | 'lastName'>): string {
  return `${user.firstName} ${user.lastName}`.trim();
}

// ---------------------------------------------------------------------------
// The account form
// ---------------------------------------------------------------------------

export type FormMode = 'create' | 'edit';

export interface AccountForm {
  firstName: string;
  lastName: string;
  tier: Tier;
  duties: Duty[];
  phone: string;
  address: string;
  /** A new PIN or password. Empty means "do not change it". */
  credential: string;
}

export const EMPTY_ACCOUNT_FORM: AccountForm = {
  firstName: '',
  lastName: '',
  tier: 'VOLUNTEER',
  duties: [],
  phone: '',
  address: '',
  credential: '',
};

/** Load an existing account into the form. `username` is deliberately not a form
 *  field — I3, and `UpdateUserRequest` has no such field by construction. */
export function accountFormFrom(user: ShapedUser): AccountForm {
  return {
    firstName: user.firstName,
    lastName: user.lastName,
    tier: user.tier,
    duties: DUTIES.filter((duty) => user.duties.includes(duty)),
    // Absent (not null) would mean the viewer may not see it — `pii.ts`. An admin
    // always may, so here absent and null both mean the field is genuinely unset.
    phone: user.phone ?? '',
    address: user.address ?? '',
    credential: '',
  };
}

// ---------------------------------------------------------------------------
// Credentials — derived from tier, never stored (`architecture.md §4.2`)
// ---------------------------------------------------------------------------

export interface CredentialPlan {
  /** `credentialKindFor(tier)`. Volunteers a 4-digit PIN, Staff/Admin a password. */
  kind: CredentialKind;
  /** True when the save cannot go through without one. */
  required: boolean;
  label: string;
  hint: string;
  /** Set only when a tier change is what makes it required, so the field can
   *  explain itself rather than just turning red. */
  reason: string | null;
}

/** True when a tier change moves the account across the PIN/password line. */
export function crossesCredentialBoundary(from: Tier, to: Tier): boolean {
  return credentialKindFor(from) !== credentialKindFor(to);
}

/**
 * Which credential field to show, and whether it must be filled.
 *
 * - Creating a Volunteer: optional. §4.2 defaults the PIN to the last four digits
 *   of the phone, and generates four digits when there is no phone.
 * - Creating Staff: required. There is nothing to default a password from.
 * - Editing without crossing the PIN/password line: optional — this is S1.8's
 *   "set/reset PIN or password", and blank means keep what they have.
 * - Editing ACROSS that line: required. A promoted volunteer must not keep a
 *   4-digit PIN on a staff account, which is the whole point of §4.2's split.
 */
export function credentialPlan(
  mode: FormMode,
  tier: Tier,
  existing: ShapedUser | null,
): CredentialPlan {
  const kind = credentialKindFor(tier);
  const crossing = existing !== null && crossesCredentialBoundary(existing.tier, tier);
  const required = mode === 'create' ? kind === 'PASSWORD' : crossing;
  const reason = crossing
    ? kind === 'PASSWORD'
      ? COPY.credential.reasonToPassword
      : COPY.credential.reasonToPin
    : null;

  if (kind === 'PIN') {
    return {
      kind,
      required,
      label: COPY.credential.pinLabel,
      hint: mode === 'create' ? COPY.credential.pinHintCreate : COPY.credential.pinHintEdit,
      reason,
    };
  }
  return {
    kind,
    required,
    label: COPY.credential.passwordLabel,
    hint:
      mode === 'create' ? COPY.credential.passwordHintCreate : COPY.credential.passwordHintEdit,
    reason,
  };
}

// ---------------------------------------------------------------------------
// Validation
//
// Communication only. Every one of these rules is enforced again server-side
// (`services/user.ts`), and this exists so the admin is told before the round trip
// rather than instead of it.
// ---------------------------------------------------------------------------

export type FieldErrors = Readonly<Record<string, string>>;

export function validateAccount(form: AccountForm, plan: CredentialPlan): FieldErrors {
  const errors: Record<string, string> = {};
  if (form.firstName.trim() === '') errors['firstName'] = COPY.requiredFirstName;
  if (form.lastName.trim() === '') errors['lastName'] = COPY.requiredLastName;

  const credential = form.credential;
  if (credential === '') {
    if (plan.required) {
      errors['credential'] =
        plan.kind === 'PIN' ? COPY.credential.missingPin : COPY.credential.missingPassword;
    }
  } else if (plan.kind === 'PIN') {
    if (!new RegExp(`^\\d{${PIN_LENGTH}}$`).test(credential)) {
      errors['credential'] = COPY.credential.badPin;
    }
  } else if (credential.length < MIN_PASSWORD_LENGTH) {
    errors['credential'] = COPY.credential.badPassword;
  }

  return errors;
}

export function isValid(errors: FieldErrors): boolean {
  return Object.keys(errors).length === 0;
}

// ---------------------------------------------------------------------------
// Turning the form into requests
// ---------------------------------------------------------------------------

/** '' means "no value", which for a nullable column is null rather than an empty
 *  string. The server trims to null as well; sending it plainly keeps the two from
 *  disagreeing about what a cleared field is. */
function orNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export interface CreateAccountBody {
  firstName: string;
  lastName: string;
  tier: Tier;
  duties: Duty[];
  phone: string | null;
  address: string | null;
  credential?: string;
}

/** `username` is never sent: it is generated (§5.1) and immutable (I3). */
export function buildCreateBody(form: AccountForm): CreateAccountBody {
  return {
    firstName: form.firstName.trim(),
    lastName: form.lastName.trim(),
    tier: form.tier,
    duties: form.duties,
    phone: orNull(form.phone),
    address: orNull(form.address),
    ...(form.credential === '' ? {} : { credential: form.credential }),
  };
}

/**
 * What an edit has to send.
 *
 * Only changed fields go, so an untouched account is not re-stamped, and
 * `username` cannot be sent at all — `UpdateUserRequest` has no such field, by
 * construction, because I3 makes it immutable.
 *
 * A credential travels INSIDE the PATCH when anything else changed, so one request
 * cannot half-apply; when it is the only change it goes to the dedicated reset
 * route instead, which is S1.8's "set/reset PIN or password".
 */
export interface UserSavePlan {
  patch: UpdateUserRequest | null;
  credentialOnly: string | null;
}

export function buildUserSave(existing: ShapedUser, form: AccountForm): UserSavePlan {
  const patch: UpdateUserRequest = {};
  const firstName = form.firstName.trim();
  const lastName = form.lastName.trim();
  const phone = orNull(form.phone);
  const address = orNull(form.address);

  if (firstName !== existing.firstName) patch.firstName = firstName;
  if (lastName !== existing.lastName) patch.lastName = lastName;
  if (form.tier !== existing.tier) patch.tier = form.tier;
  // I2 — a set comparison, never an ordered one.
  if (!sameDuties(form.duties, existing.duties)) patch.duties = form.duties;
  if (phone !== (existing.phone ?? null)) patch.phone = phone;
  if (address !== (existing.address ?? null)) patch.address = address;

  const changedFields = Object.keys(patch).length > 0;
  if (form.credential !== '') {
    if (changedFields) {
      patch.credential = form.credential;
      return { patch, credentialOnly: null };
    }
    return { patch: null, credentialOnly: form.credential };
  }

  return { patch: changedFields ? patch : null, credentialOnly: null };
}

/** Nothing to send — the Save button has no work to do. */
export function isNoOp(plan: UserSavePlan): boolean {
  return plan.patch === null && plan.credentialOnly === null;
}

/**
 * What to tell the admin about a brand-new account's PIN, or null when there is
 * nothing to say because they typed the credential themselves.
 *
 * Two cases, both from `architecture.md §4.2`'s default:
 *   - The server picked four digits (no phone on file to take them from). That PIN
 *     is hashed on the way in and never logged, so this is the ONLY time it can be
 *     shown — hence "write it down".
 *   - A phone was on file, so the PIN is its last four digits. Nothing secret to
 *     reveal; the admin just needs to know what to tell them.
 */
export function createdNotice(
  name: string,
  form: AccountForm,
  generatedCredential: string | undefined,
): string | null {
  if (generatedCredential !== undefined) {
    return `${name}'s PIN is ${generatedCredential}. ${COPY.pinNotice.writeItDown}`;
  }
  if (form.credential === '' && credentialKindFor(form.tier) === 'PIN') {
    return `${name} signs in with the last 4 digits of their phone.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// I21 removal — reporting which branch ran
// ---------------------------------------------------------------------------

/**
 * The sentence after a Remove.
 *
 * I21: a record with referencing history is deactivated and every reference to it
 * still resolves; one with none is gone. The SERVER decides which, and this only
 * says which happened, in words about the consequence rather than the mechanism.
 * The admin was never asked to choose, and must not be.
 */
export function removalText(
  entity: MasterEntity | 'user',
  name: string,
  outcome: RemovalOutcome,
): string {
  if (outcome === 'DELETED') {
    switch (entity) {
      case 'user':
        return `${name}'s account is gone. Nothing in R3 pointed at it.`;
      case 'category':
        return `${name} is gone. Nothing had been weighed under it.`;
      default:
        return `${name} is gone. Nothing in R3 pointed at it.`;
    }
  }
  switch (entity) {
    case 'user':
      return `${name} can't sign in any more. Their runs and history are kept.`;
    case 'donor':
      return `${name} is off the pickup lists. Past runs still show it.`;
    case 'truck':
      return `${name} is off the truck list. Past runs still show it.`;
    case 'category':
      return `${name} is archived. New weighing won't offer it; reports still do.`;
  }
}

/** The chip on a row that is no longer in use. The word differs per entity and
 *  nowhere else — `shared/src/masters.ts` carries `active` on the wire and lets the
 *  screen supply the label (§3.3: DEACTIVATED / INACTIVE / ARCHIVED). */
export function inactiveLabel(entity: MasterEntity | 'user'): string {
  switch (entity) {
    case 'category':
      return 'Archived';
    case 'truck':
      return 'Inactive';
    default:
      return 'Deactivated';
  }
}

/** The two-state control in a master edit form. Not a delete: §3.3's ACTIVE ⇄
 *  DEACTIVATED toggle is an ordinary field edit, which I21 always allows. */
export function statusChoices(
  entity: MasterEntity,
): readonly { value: 'active' | 'inactive'; label: string }[] {
  return [
    { value: 'active', label: COPY.master.inUse },
    { value: 'inactive', label: inactiveLabel(entity) },
  ];
}

// ---------------------------------------------------------------------------
// Master records — one shape for donors, trucks and categories
//
// Three entities with one shape family, because `domain-modeling.md §3.3` gives all
// three the same single lifecycle toggle and the wire carries the same `active` bit
// for each (`shared/src/masters.ts`). The fields differ; the panel does not.
// ---------------------------------------------------------------------------

/**
 * What a master field IS, not just what it is called.
 *
 * Text-only until D20 asked for a donor photo. The alternative was a second panel
 * for donors, which would have meant two places to keep I21's removal wording
 * honest — the exact duplication `MasterPanel` exists to prevent. So the field
 * list grew a kind instead, and `MasterPanel` renders one of two controls per
 * field rather than one control per entity.
 *
 * `'text'` when absent, so the three configs that predate this need no edit and no
 * field is a kind by accident of being written without one.
 */
/**
 * `choice` arrived with D40, which merged Category matching into Categories.
 *
 * An AGFP category's NTFB target is a pick from a short, seeded list (D26), so it
 * is neither free text nor a picture — and it belongs INLINE on the category's own
 * editor rather than on a second tab, so that an admin says where a category
 * reports while they are configuring it instead of finishing and going somewhere
 * else to finish again. `options` on the spec is what turns it into a control.
 */
export type MasterFieldKind = 'text' | 'image' | 'choice';

export interface MasterFieldSpec {
  key: string;
  label: string;
  /** Defaults to `'text'`. */
  kind?: MasterFieldKind;
  required?: boolean;
  /** Text only. */
  multiline?: boolean;
  hint?: string;
  /**
   * A hint that depends on what is currently typed, overriding `hint` when it
   * answers.
   *
   * Added for D27's trash rates, where a BLANK field is not an empty field: it
   * means "use the pantry default", and the admin cannot see what that default is
   * from a control that is showing nothing. Returning `undefined` falls back to
   * `hint`, so a field that has no state-dependent thing to say keeps one sentence
   * in one place.
   */
  hintFor?: (value: string) => string | undefined;
  /**
   * Communication only, like every client check (`CLAUDE.md`). The server refuses
   * the same value again — `ck_donor_trash_rates` is real DDL — and this exists so
   * an admin is told before the round trip rather than instead of it.
   */
  validate?: (value: string) => string | null;
  /** A group heading rendered ABOVE this field, with one sentence under it. Set on
   *  the first field of a group; the rest of the group leaves it absent. */
  section?: { title: string; body: string };
  /**
   * `choice` only: what may be picked, in the order it is offered.
   *
   * A FUNCTION of what the panel has loaded rather than a fixed list, because the
   * one choice field in the app is D40's NTFB target and its options are rows in
   * `ntfb_category` — an admin can archive one in the section directly below the
   * form. `context` is whatever the config's `load` put there.
   */
  options?: (context: MasterContext) => readonly MasterChoice[];
}

/** One option on a `choice` field. `value` is `''` for the explicit "none", which
 *  keeps the control a plain string field like every other one here. */
export interface MasterChoice {
  value: string;
  label: string;
  /** Shown under the option where it needs saying. */
  note?: string | undefined;
}

/**
 * Whatever a master panel loaded alongside its records.
 *
 * D40's Categories tab needs the food bank's category list twice over: once to
 * offer as choices on a category's editor, and once as the reference list below
 * it. It is loaded once, by the config, and handed to both.
 */
export interface MasterContext {
  ntfbCategories: readonly { id: string; name: string; code: string | null; active: boolean; mappedCount: number }[];
}

export const EMPTY_MASTER_CONTEXT: MasterContext = { ntfbCategories: [] };

export function fieldKind(field: MasterFieldSpec): MasterFieldKind {
  return field.kind ?? 'text';
}

export interface MasterRecordView {
  id: string;
  /** The row's first line, and the name used in a removal sentence. */
  title: string;
  subtitle: string | null;
  active: boolean;
  /** Field values by `MasterFieldSpec.key`, ready to edit. */
  values: Readonly<Record<string, string>>;
}

export function emptyMasterValues(fields: readonly MasterFieldSpec[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of fields) values[field.key] = '';
  return values;
}

export function validateMaster(
  fields: readonly MasterFieldSpec[],
  values: Readonly<Record<string, string>>,
): FieldErrors {
  const errors: Record<string, string> = {};
  for (const field of fields) {
    const value = values[field.key] ?? '';
    if (field.required === true && value.trim() === '') {
      errors[field.key] = COPY.requiredName;
      continue;
    }
    const own = field.validate?.(value) ?? null;
    if (own !== null) errors[field.key] = own;
  }
  return errors;
}

/** The hint under a field right now: the state-dependent one where there is one,
 *  the static one otherwise. */
export function hintForField(
  field: MasterFieldSpec,
  value: string,
): string | undefined {
  return field.hintFor?.(value) ?? field.hint;
}

// ---------------------------------------------------------------------------
// Trash rates — a percentage on screen, a decimal fraction on the wire (D27)
//
// THE ONE PLACE IN R3 WHERE A NUMBER SILENTLY CHANGES WHAT THE FOOD BANK IS TOLD.
// A store's rate decides how much of its bakery, produce and deli weight is
// reported as Trash instead of as food, per receipt, for as long as it stands.
//
// THREE THINGS THIS CONVERSION HAS TO GET RIGHT:
//
//   1. **Blank is not zero.** Blank means "use the pantry default"; `0` means this
//      store genuinely wastes nothing. They are different rows in the database
//      (`NULL` against `0.0000`), different edits on the wire (`UpdateDonorRequest`
//      distinguishes absent from null on purpose), and they must stay different on
//      screen — a blank that saved as 0 would silently stop a store's produce ever
//      being deducted, and nothing would say so.
//   2. **No float.** `numeric(5,4)` is exact and `10 / 100` in JavaScript is not
//      reliably `0.1`. Both directions here are string surgery: shifting a decimal
//      point two places, never dividing.
//   3. **It round-trips.** What an admin typed comes back as what they typed:
//      `10` → `0.1000` → `10`, and `''` → `null` → `''`.
// ---------------------------------------------------------------------------

/** `numeric(5,4)`: four decimals, so a percentage carries at most two. */
const PERCENT_DECIMALS = 2;
const PERCENT_PATTERN = /^\d{1,3}(\.\d{1,2})?$/;

/** Move a plain decimal's point, in string form. Positive moves it right
 *  (multiplies), negative moves it left (divides). Null for anything that is not a
 *  plain decimal, which is shown as it arrived rather than guessed at. */
function shiftPoint(value: string, places: number): string | null {
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const [whole = '0', fraction = ''] = trimmed.split('.');
  const digits = whole + fraction;
  // Where the point lands, counted from the left of `digits`.
  const point = whole.length + places;
  const padded =
    point < 0 ? '0'.repeat(-point) + digits : digits + '0'.repeat(Math.max(0, point - digits.length));
  const at = Math.max(point, 0);
  const left = padded.slice(0, at) || '0';
  const right = padded.slice(at);
  return right === '' ? left : `${left}.${right}`;
}

/** Drop leading and trailing zeros a person would not type: `010.00` → `10`. */
function tidy(value: string): string {
  const [whole = '0', fraction] = value.split('.');
  const lead = whole.replace(/^0+(?=\d)/, '');
  if (fraction === undefined) return lead;
  const kept = fraction.replace(/0+$/, '');
  return kept === '' ? lead : `${lead}.${kept}`;
}

/**
 * The wire's decimal fraction as the percentage the field shows: `'0.1000'` →
 * `'10'`, `'0.0000'` → `'0'`, `null` → `''`.
 *
 * `null` becomes BLANK and never `0`. That distinction is the whole point of the
 * column being nullable.
 */
export function percentFromRate(rate: string | null): string {
  if (rate === null) return '';
  const shifted = shiftPoint(rate, PERCENT_DECIMALS);
  // A figure that is not a plain decimal is shown exactly as it arrived rather
  // than replaced by a guess — the same rule S3.1 applies to a weight.
  return shifted === null ? rate.trim() : tidy(shifted);
}

/**
 * The typed percentage as the wire's decimal fraction: `'10'` → `'0.1000'`,
 * `'0'` → `'0.0000'`, `''` → `null`.
 *
 * `null` is an EXPLICIT clear, not an omission: `UpdateDonorRequest` distinguishes
 * absent ("leave it") from null ("back to the pantry default"), and a blank field
 * means the second.
 */
export function rateFromPercent(percent: string): string | null {
  const trimmed = percent.trim();
  if (trimmed === '') return null;
  const shifted = shiftPoint(trimmed, -PERCENT_DECIMALS);
  // Unparseable goes to the server as typed, which refuses it with its own
  // sentence. Silently sending null instead would turn a typo into "use the
  // default" and say nothing.
  if (shifted === null) return trimmed;
  const [whole = '0', fraction = ''] = shifted.split('.');
  return `${whole}.${fraction.padEnd(4, '0').slice(0, 4)}`;
}

/** What an out-of-range or mistyped percentage says. Communication only; the
 *  server's `ck_donor_trash_rates` is the rule. */
export function percentError(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (!PERCENT_PATTERN.test(trimmed)) return COPY.rates.badNumber;
  if (Number(trimmed) > 100) return COPY.rates.outOfRange;
  return null;
}

/** A required field on its way to the wire: trimmed, never null — it is validated
 *  first, and the server refuses an empty one again. */
export function trimmedValue(values: Readonly<Record<string, string>>, key: string): string {
  return (values[key] ?? '').trim();
}

/** An optional field on its way to the wire. '' is a CLEARED field, which for a
 *  nullable column is null rather than an empty string; the services trim to null
 *  too, and sending it plainly keeps the two from disagreeing. */
export function nullableValue(
  values: Readonly<Record<string, string>>,
  key: string,
): string | null {
  const trimmed = trimmedValue(values, key);
  return trimmed === '' ? null : trimmed;
}

// ---------------------------------------------------------------------------
// An image field's value (D20)
//
// The photo does not travel with the record: `DonorSummary` carries `hasPhoto`,
// a bit, and the bytes come from `GET /donors/:id/photo` on demand, so a list of
// fifteen stores is not fifteen images. That makes an image field's string one of
// exactly three things:
//
//   ''            no photo. Also what a create form starts at, and what Remove
//                 leaves behind.
//   'data:...'    one the admin just chose, already canvas-resized (`photo.ts`).
//                 The ONLY value that is bytes rather than a reference.
//   anything else the URL the stored photo is served from, i.e. unchanged.
//
// Which means the save can be decided by comparing the loaded string with the
// current one, and no photo request is made for a donor edit that did not touch
// the photo.
// ---------------------------------------------------------------------------

export const DATA_URL_PREFIX = 'data:';

export type PhotoChange =
  | { kind: 'none' }
  | { kind: 'set'; dataUrl: string }
  | { kind: 'clear' };

export function photoChange(before: string, after: string): PhotoChange {
  if (after === before) return { kind: 'none' };
  if (after.startsWith(DATA_URL_PREFIX)) return { kind: 'set', dataUrl: after };
  if (after === '') return { kind: 'clear' };
  // Back to the stored one from a data URL — an admin who chose a file and then
  // changed their mind. Nothing to send.
  return { kind: 'none' };
}

// ---------------------------------------------------------------------------
// Errors on a write
// ---------------------------------------------------------------------------

/**
 * What to show when a save is refused.
 *
 * The server's own sentence when it sent one — "A volunteer PIN is exactly 4
 * digits", "Admin accounts are not created directly" — because it is more specific
 * than anything generic, and §6's error pattern is what happened plus what to do.
 * Falls back to the one plain message per kind (`api/errors.ts`), and never shows a
 * code (§6).
 */
export function writeFailureText(cause: unknown): string {
  const error = toApiError(cause);
  return error.detail ?? error.message;
}
