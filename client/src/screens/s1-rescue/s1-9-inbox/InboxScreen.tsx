// S1.9 — the notification inbox.
//
// "Every event lands here regardless of push" (`ui-ux-spec.md S1.9`, PRD channel
// strategy), so this screen is the reliable baseline and the banner is the optional
// layer on top. Newest first, an unread dot, tap to act — and the push-state chip in
// the header (§5), because the one place a user should learn that alerts are off is
// the screen that still works without them.
//
// Phone AND desktop, both canonical (responsive matrix). Nothing here is a phone
// affordance: one column, big rows, no gestures.

import { useCallback, useEffect, useState } from 'react';
import type { ScreenProps } from '../../../app/index.ts';
import { useAsyncData, useRouter, useToast } from '../../../app/index.ts';
import {
  Button,
  EmptyState,
  ErrorBlock,
  InboxRow,
  PushStateChip,
  SkeletonRows,
} from '../../../components/index.ts';
import { usePwa } from '../../../pwa/index.ts';
import { fetchInbox, markAllRead, markRead, type InboxItem, type InboxPage } from './api.ts';
import { COPY, rowText, withAllRead, withItemRead } from './inbox.ts';
import './inbox.css';

export function InboxScreen(_props: ScreenProps) {
  const { navigate } = useRouter();
  const toast = useToast();
  // §5's chip, and its "tap to fix". Only a screen the user is signed in to renders
  // at all, so the flow is always live here.
  const pwa = usePwa(true);

  const load = useCallback((signal: AbortSignal) => fetchInbox(signal), []);
  const state = useAsyncData<InboxPage>(load);

  // The list is held locally once loaded so a tap can move the dot and the count
  // before the server answers — the screen is usually gone by the time it does.
  const [page, setPage] = useState<InboxPage | null>(null);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    if (state.data) setPage(state.data);
  }, [state.data]);

  const open = useCallback(
    (item: InboxItem) => {
      if (!item.read) {
        setPage((current) => (current ? withItemRead(current, item.id) : current));
        void markRead(item.id)
          .then((result) => {
            setPage((current) =>
              current ? { ...current, unreadCount: result.unreadCount } : current,
            );
          })
          .catch(() => toast.error(COPY.markReadFailed));
      }
      // The server computed this destination, and the alert banner uses the same one
      // (`services/notification.ts`, `sw.ts`). An event with no run behind it points
      // back here, which the router treats as a no-op.
      navigate(item.url);
    },
    [navigate, toast],
  );

  const clearAll = useCallback(async () => {
    setClearing(true);
    try {
      const result = await markAllRead();
      setPage((current) => (current ? withAllRead(current, result.unreadCount) : current));
    } catch {
      toast.error(COPY.markAllFailed);
    } finally {
      setClearing(false);
    }
  }, [toast]);

  const header = (
    <header className="r3-inbox__header">
      <h1 className="r3-inbox__title">{COPY.title}</h1>
      <div className="r3-inbox__header-actions">
        {/* §3 prefers hiding over disabling: nothing to clear, no control. */}
        {page && page.unreadCount > 0 ? (
          <Button variant="secondary" onClick={() => void clearAll()} loading={clearing}>
            {COPY.markAll}
          </Button>
        ) : null}
        {pwa.alertsEnabled === undefined ? null : (
          <PushStateChip enabled={pwa.alertsEnabled} onFix={() => void pwa.fix()} />
        )}
      </div>
    </header>
  );

  let body;
  if (state.error && !page) {
    body = <ErrorBlock error={state.error} onRetry={state.reload} />;
  } else if (!page) {
    body = state.showLoading ? <SkeletonRows rows={4} label={COPY.loading} /> : null;
  } else if (page.items.length === 0) {
    body = <EmptyState title={COPY.emptyTitle}>{COPY.emptyBody}</EmptyState>;
  } else {
    body = (
      <ul className="r3-inbox__list">
        {page.items.map((item) => (
          <li key={item.id}>
            <InboxRow
              text={rowText(item)}
              time={item.when}
              read={item.read}
              onOpen={() => open(item)}
            />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="r3-inbox">
      {header}
      {body}
    </div>
  );
}
