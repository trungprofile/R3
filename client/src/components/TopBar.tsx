// Top bar — `ui-ux-spec.md §3`, and §4: "Top bar is identical everywhere for
// consistency." One instance, rendered by the shell, on every screen and every
// device.
//
// Contents, left to right: the AGFP heart, the current user's name, the
// notification bell with its unread count, the alerts chip, and Logout.
//
// LOGOUT IS ALWAYS VISIBLE (§5). On a shared tablet it is the only way a
// volunteer ends their sign-in deliberately, and hiding it behind a menu on a
// device used by a dozen people is how the next person inherits someone else's
// account.

import { BellIcon, HeartIcon } from './icons.tsx';
import { PushStateChip } from './StatusChip.tsx';

export interface TopBarProps {
  /** The signed-in person's name. Absent before sign-in. */
  userName?: string;
  unreadCount?: number;
  onOpenInbox?: () => void;
  onLogout?: () => void;
  /** Alerts on/off. Omit where push state is not known yet. */
  alertsEnabled?: boolean;
  onFixAlerts?: () => void;
}

export function TopBar({
  userName,
  unreadCount = 0,
  onOpenInbox,
  onLogout,
  alertsEnabled,
  onFixAlerts,
}: TopBarProps) {
  return (
    <header className="r3-topbar">
      <span className="r3-topbar__brand">
        <HeartIcon className="r3-topbar__heart" />
        <span>R3</span>
      </span>

      <span className="r3-topbar__spacer" />

      {alertsEnabled === undefined ? null : (
        <PushStateChip enabled={alertsEnabled} {...(onFixAlerts ? { onFix: onFixAlerts } : {})} />
      )}

      {onOpenInbox ? (
        <button
          type="button"
          className="r3-topbar__action r3-topbar__bell"
          onClick={onOpenInbox}
          aria-label={unreadCount > 0 ? `Inbox, ${unreadCount} unread` : 'Inbox'}
        >
          <BellIcon />
          {unreadCount > 0 ? (
            <span className="r3-topbar__badge" aria-hidden="true">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          ) : null}
        </button>
      ) : null}

      {userName ? <span className="r3-topbar__user">{userName}</span> : null}

      {onLogout ? (
        <button type="button" className="r3-topbar__action" onClick={onLogout}>
          Log out
        </button>
      ) : null}
    </header>
  );
}
