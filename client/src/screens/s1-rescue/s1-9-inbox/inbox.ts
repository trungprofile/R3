// S1.9's rules, separated from its markup.
//
// PURE ON PURPOSE. There is no component test harness in this repo and adding one
// would be a dependency (build-plan §3/D5), so the parts of this screen that can be
// wrong — the sentence a row reads as, and what a tap does to the list and the bell
// before the server answers — are functions a test can call without a browser.
//
// The optimistic update matters more than it looks: tapping a row navigates away to
// the run it is about, so the list is often unmounted before the server's answer
// lands. The count the user next sees comes from this, not from the response.

import type { InboxItem, InboxPage } from './api.ts';

/**
 * One line: what happened, and which run it was about.
 *
 * Both halves are the server's words — the same ones the alert banner used, so the
 * inbox and the banner never give two accounts of one event. `detail` is absent when
 * the event has no run behind it (a driver's time off, say).
 */
export function rowText(item: Pick<InboxItem, 'title' | 'detail'>): string {
  return item.detail === null || item.detail === '' ? item.title : `${item.title} — ${item.detail}`;
}

/** One row read. The count floors at zero rather than trusting arithmetic against a
 *  list that may be one page of a longer inbox. */
export function withItemRead(page: InboxPage, id: string): InboxPage {
  const item = page.items.find((candidate) => candidate.id === id);
  if (!item || item.read) return page;
  return {
    items: page.items.map((candidate) =>
      candidate.id === id ? { ...candidate, read: true } : candidate,
    ),
    unreadCount: Math.max(0, page.unreadCount - 1),
  };
}

/** Everything read. The server's count is authoritative — this page may be a
 *  bounded view of a longer inbox, so the local list cannot be used to derive it. */
export function withAllRead(page: InboxPage, unreadCount: number): InboxPage {
  return {
    items: page.items.map((item) => (item.read ? item : { ...item, read: true })),
    unreadCount,
  };
}

/**
 * Screen copy — `ui-ux-spec.md §7`: plain, short, second person, and none of the
 * vocabulary that section forbids. Held here so the test can check it against
 * `FORBIDDEN_IN_COPY` rather than trusting a reading.
 *
 * The empty state says what will land here, not "nothing here" (§6). Nothing implies
 * a run ever finishes: no Phase-1 run reaches a completed state (build-plan D1).
 */
export const COPY = {
  title: 'Inbox',
  markAll: 'Mark all as read',
  emptyTitle: 'Nothing here yet.',
  emptyBody:
    "You'll see the runs you're on, a reminder an hour before each one, and runs that still need a driver.",
  markReadFailed: "Couldn't mark that as read. Try again.",
  markAllFailed: "Couldn't update your inbox. Try again.",
  loading: 'Loading your inbox',
} as const;
