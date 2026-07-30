// S1.8's calls, all through the typed fetch layer.
//
// Every endpoint here already existed before this screen: accounts came with
// Wave 1's identity work, the three master lists with Wave 2's. Nothing is
// invented — the paths, verbs and bodies below were read off `server/src/routes/`
// (`users.ts`, `donors.ts`, `trucks.ts`, `categories.ts`), and the request shapes
// are `shared/src`'s own types rather than restatements of them.
//
// `fetch` is never called directly: a raw call would miss the session cookie, the
// one error shape (§6) and the offline banner all at once.

import { api } from '../../../api/index.ts';
import type {
  CategorySummary,
  CreateCategoryRequest,
  CreateDonorRequest,
  CreateTruckRequest,
  DonorSummary,
  RemovalOutcome,
  RemoveMasterResponse,
  RemoveUserResponse,
  SetCredentialRequest,
  ShapedUser,
  TruckSummary,
  UpdateCategoryRequest,
  UpdateDonorRequest,
  UpdateTruckRequest,
  UpdateUserRequest,
} from '../../../api/shared.ts';
import type { CreateAccountBody } from './logic.ts';

function path(base: string, id: string): string {
  return `${base}/${encodeURIComponent(id)}`;
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

/**
 * `POST /users`' 201 body.
 *
 * Declared here because `shared/src` has no type for it — `routes/users.ts`
 * assembles it inline as `{ user, generatedCredential? }`. `generatedCredential`
 * is present only when the server picked the PIN itself (no phone on file to take
 * the last four digits from), and it is the ONLY time that PIN is ever visible:
 * it is hashed on the way in and never logged (`architecture.md §5.4`).
 */
export interface CreatedAccount {
  user: ShapedUser;
  generatedCredential?: string;
}

/** Every account, active and deactivated — S1.8's list. A deactivated account is
 *  still shown, with its own chip, because I21 keeps it and its username stays
 *  reserved (I3); hiding it would make the reservation look like a bug. */
export function fetchAccounts(signal: AbortSignal): Promise<ShapedUser[]> {
  return api.get<ShapedUser[]>('/users', { signal });
}

export function createAccount(body: CreateAccountBody): Promise<CreatedAccount> {
  return api.post<CreatedAccount>('/users', { body });
}

/** I3 — no `username` field exists on `UpdateUserRequest` to send. */
export function updateAccount(id: string, body: UpdateUserRequest): Promise<ShapedUser> {
  return api.patch<ShapedUser>(path('/users', id), { body });
}

/** S1.8's "set/reset PIN or password" on its own, with nothing else changing. */
export function setAccountCredential(id: string, credential: string): Promise<void> {
  const body: SetCredentialRequest = { credential };
  return api.post<void>(`${path('/users', id)}/credential`, { body });
}

/** I21 — the server decides hard-delete vs deactivate and answers which. The
 *  caller reports the outcome; it never predicts it. */
export function removeAccount(id: string): Promise<RemoveUserResponse> {
  return api.delete<RemoveUserResponse>(path('/users', id));
}

// ---------------------------------------------------------------------------
// Donors, trucks, categories
//
// `?includeInactive=true` on every list: the three routes default to the active
// set (for the driver and receiver screens that consume them), and the admin list
// is the one place that must see what has been deactivated, archived or taken out
// of service.
// ---------------------------------------------------------------------------

const INCLUDE_INACTIVE = { includeInactive: 'true' } as const;

export function fetchDonors(signal: AbortSignal): Promise<DonorSummary[]> {
  return api.get<DonorSummary[]>('/donors', { query: INCLUDE_INACTIVE, signal });
}

export function createDonor(body: CreateDonorRequest): Promise<DonorSummary> {
  return api.post<DonorSummary>('/donors', { body });
}

export function updateDonor(id: string, body: UpdateDonorRequest): Promise<DonorSummary> {
  return api.patch<DonorSummary>(path('/donors', id), { body });
}

export function fetchTrucks(signal: AbortSignal): Promise<TruckSummary[]> {
  return api.get<TruckSummary[]>('/trucks', { query: INCLUDE_INACTIVE, signal });
}

export function createTruck(body: CreateTruckRequest): Promise<TruckSummary> {
  return api.post<TruckSummary>('/trucks', { body });
}

export function updateTruck(id: string, body: UpdateTruckRequest): Promise<TruckSummary> {
  return api.patch<TruckSummary>(path('/trucks', id), { body });
}

export function fetchCategories(signal: AbortSignal): Promise<CategorySummary[]> {
  return api.get<CategorySummary[]>('/categories', { query: INCLUDE_INACTIVE, signal });
}

export function createCategory(body: CreateCategoryRequest): Promise<CategorySummary> {
  return api.post<CategorySummary>('/categories', { body });
}

export function updateCategory(id: string, body: UpdateCategoryRequest): Promise<CategorySummary> {
  return api.patch<CategorySummary>(path('/categories', id), { body });
}

/** One remove for all three: same route shape, same I21 answer. */
export async function removeMaster(
  base: '/donors' | '/trucks' | '/categories',
  id: string,
): Promise<RemovalOutcome> {
  const response = await api.delete<RemoveMasterResponse>(path(base, id));
  return response.outcome;
}
