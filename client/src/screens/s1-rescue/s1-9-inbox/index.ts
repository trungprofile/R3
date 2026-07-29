// S1.9 — notification inbox.
//
// `main.tsx`'s SCREENS registry takes `InboxScreen` under the `inbox` id; the route
// (`/inbox`, no tier or duty requirement) is already declared in `app/routes.ts`.
// The lead wires both at merge — this lane owns the folder, not the registry.
//
// `useUnreadCount` is the other half the shell needs: the number `AppShell` puts on
// the top-bar bell.

export { InboxScreen } from './InboxScreen.tsx';
export { useUnreadCount, UNREAD_POLL_MS } from './useUnreadCount.ts';
export { COPY, rowText, withAllRead, withItemRead } from './inbox.ts';
export {
  fetchInbox,
  fetchUnreadCount,
  markAllRead,
  markRead,
} from './api.ts';
export type {
  InboxItem,
  InboxPage,
  MarkAllReadResult,
  MarkReadResult,
  UnreadCount,
} from './api.ts';
