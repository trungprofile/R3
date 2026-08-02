// The requests the AGFP→NTFB matching editor makes, and no others.
//
// They still live under `/report/*` on the server: the paths are the report's
// vocabulary and renaming them would be a wire change for no gain. What DID change
// is who may call them — `{ tier: 'ADMIN' }` rather than the `REPORT` duty, which is
// the whole of D17's "route-access change and a screen move" (`routes/report.ts`).
//
// Everything goes through the typed fetch layer (`client/src/api/client.ts`) so each
// call carries the sign-in cookie, turns every failure into one plain message (§6)
// and raises the blocking offline banner. A raw `fetch` from a screen misses all
// three. NOTHING HERE RETRIES: §6 makes retry a visible affordance, never a silent
// loop behind a spinner.

import { api } from '../../../../api/index.ts';
import type {
  CategoryMapping,
  CreateNtfbCategoryRequest,
  NtfbCategory,
  RemovalOutcome,
  RemoveMasterResponse,
  SetMappingRequest,
  UpdateNtfbCategoryRequest,
} from '../../../../api/shared.ts';

export function fetchNtfbCategories(signal: AbortSignal): Promise<NtfbCategory[]> {
  return api.get<NtfbCategory[]>('/report/ntfb-categories', { signal });
}

export function createNtfbCategory(body: CreateNtfbCategoryRequest): Promise<NtfbCategory> {
  return api.post<NtfbCategory>('/report/ntfb-categories', { body });
}

/** Rename, re-code, or put an archived one back in use (§3.3's reverse arrow).
 *  Archiving is not here: it goes through `removeNtfbCategory`, where I21 decides
 *  which of the two happened. */
export function updateNtfbCategory(
  id: string,
  body: UpdateNtfbCategoryRequest,
): Promise<NtfbCategory[]> {
  return api.patch<NtfbCategory[]>(`/report/ntfb-categories/${encodeURIComponent(id)}`, { body });
}

/** I21, same as every other master record: archived if anything reports under it,
 *  destroyed only when nothing does. The caller does not choose; it is told. */
export async function removeNtfbCategory(id: string): Promise<RemovalOutcome> {
  const response = await api.delete<RemoveMasterResponse>(
    `/report/ntfb-categories/${encodeURIComponent(id)}`,
  );
  return response.outcome;
}

export function fetchMappings(signal: AbortSignal): Promise<CategoryMapping[]> {
  return api.get<CategoryMapping[]>('/report/mappings', { signal });
}

/** Point one AGFP category at a food bank category, or clear it with an explicit
 *  null. Returns the whole mapping list, so the editor never has to patch its own
 *  copy of it. */
export function setMapping(
  categoryId: string,
  body: SetMappingRequest,
): Promise<CategoryMapping[]> {
  return api.put<CategoryMapping[]>(`/report/mappings/${encodeURIComponent(categoryId)}`, { body });
}
