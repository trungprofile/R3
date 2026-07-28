// Inbox row — `ui-ux-spec.md §3`: read/unread dot, event text, time, tap to act.
//
// The inbox is the source of truth for every event, whether or not a push ever
// arrived (S1.9), so a row must be readable on its own — the event text says what
// happened without needing the alert that may never have been delivered.

import { ListRow } from './ListRow.tsx';

export interface InboxRowProps {
  /** One plain sentence: what happened. */
  text: string;
  /** Already-formatted for reading, e.g. "Tue 9:00 AM". */
  time: string;
  read: boolean;
  /** Deep-links to the shift the event is about. */
  onOpen?: () => void;
}

export function InboxRow({ text, time, read, onOpen }: InboxRowProps) {
  return (
    <div className={read ? 'r3-inbox-row' : 'r3-inbox-row r3-inbox-row--unread'}>
      <ListRow
        title={
          <>
            <span
              className={`r3-inbox-row__dot${read ? ' r3-inbox-row__dot--read' : ''}`}
              aria-hidden="true"
            />{' '}
            {text}
          </>
        }
        side={<span className="r3-inbox-row__time">{time}</span>}
        ariaLabel={read ? text : `Unread. ${text}`}
        {...(onOpen ? { onClick: onOpen } : {})}
      />
    </div>
  );
}
