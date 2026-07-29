// The inbox endpoints, typed.
//
// Everything goes through `api` (`client/src/api/index.ts`): a raw `fetch` would
// miss the session cookie, the one error shape (§6) and the offline banner at once.
//
// THE TYPES ARE RESTATED HERE ON PURPOSE. `shared/src` is single-owner (build-plan
// §3) and no wave-4 lane may edit it, so the inbox's wire vocabulary is declared on
// both sides — `server/src/routes/notifications.ts` holds the other copy. The
// duplication is deliberate and recorded in this lane's report; a cross-lane edit to
// the shared vocabulary while four lanes are running is the worse trade.

import { api } from '../../../api/index.ts';

/** One row of the inbox. Rendered text and the deep link both arrive shaped: the
 *  server renders them from the same copy the alert banner used, and it is the half
 *  that knows the pantry's timezone. */
export interface InboxItem {
  id: string;
  /** The event identifier. Diagnostic only — never rendered (`ui-ux-spec.md §7`). */
  event: string;
  /** The sentence: what happened. */
  title: string;
  /** Which run, when — or null. */
  detail: string | null;
  /** Where "tap to act" goes: the shift, or back here when there is no shift. */
  url: string;
  shiftId: string | null;
  read: boolean;
  createdAt: string;
  /** Already formatted for reading, in the pantry's zone: "Tue 9:00 AM". */
  when: string;
}

export interface InboxPage {
  items: InboxItem[];
  unreadCount: number;
}

export interface UnreadCount {
  unreadCount: number;
}

export interface MarkReadResult {
  id: string;
  readAt: string;
  unreadCount: number;
}

export interface MarkAllReadResult {
  marked: number;
  unreadCount: number;
}

const PATH = '/notifications';

export function fetchInbox(signal?: AbortSignal): Promise<InboxPage> {
  return api.get<InboxPage>(PATH, { ...(signal ? { signal } : {}) });
}

/** The bell's number alone — one indexed count, no rows. */
export function fetchUnreadCount(signal?: AbortSignal): Promise<UnreadCount> {
  return api.get<UnreadCount>(`${PATH}/unread-count`, { ...(signal ? { signal } : {}) });
}

export function markRead(id: string): Promise<MarkReadResult> {
  return api.post<MarkReadResult>(`${PATH}/${encodeURIComponent(id)}/read`);
}

export function markAllRead(): Promise<MarkAllReadResult> {
  return api.post<MarkAllReadResult>(`${PATH}/read-all`);
}
