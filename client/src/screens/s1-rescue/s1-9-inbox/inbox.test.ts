// S1.9's rules, without a browser.
//
// There is no component test harness in this repo and adding one would be a
// dependency (build-plan §3/D5), so nothing here renders. These cover what a wrong
// answer would silently break: the sentence a row reads as, the optimistic update
// that runs while the screen is being unmounted by its own tap, and the copy §7
// forbids.
//
// Run: npx vitest run --root client

import { describe, expect, it } from 'vitest';
import { COPY, rowText, withAllRead, withItemRead } from './inbox.ts';
import type { InboxItem, InboxPage } from './api.ts';
import { FORBIDDEN_IN_COPY } from '../../../pwa/index.ts';

function item(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: 'n1',
    event: 'SHIFT_ASSIGNED',
    title: "You're on a run",
    detail: 'Tue Aug 4, 2:00 PM — Tuesday North',
    url: '/shifts/s1',
    shiftId: 's1',
    read: false,
    createdAt: '2026-08-03T14:00:00.000Z',
    when: 'Mon 9:00 AM',
    ...overrides,
  };
}

function page(items: InboxItem[]): InboxPage {
  return { items, unreadCount: items.filter((entry) => !entry.read).length };
}

describe('row text', () => {
  it('joins what happened to which run it was about', () => {
    expect(rowText(item())).toBe("You're on a run — Tue Aug 4, 2:00 PM — Tuesday North");
  });

  it('is just the sentence when the event has no run behind it', () => {
    expect(rowText(item({ title: 'Karen set time off', detail: null }))).toBe(
      'Karen set time off',
    );
  });
});

describe('marking one read', () => {
  it('moves the dot and the count together', () => {
    const before = page([item({ id: 'a' }), item({ id: 'b' })]);
    const after = withItemRead(before, 'a');

    expect(after.items.map((entry) => entry.read)).toEqual([true, false]);
    expect(after.unreadCount).toBe(1);
  });

  it('does nothing to a row that was already read', () => {
    const before = page([item({ id: 'a', read: true })]);
    expect(withItemRead(before, 'a')).toBe(before);
  });

  it('ignores an id that is not on this page', () => {
    const before = page([item({ id: 'a' })]);
    expect(withItemRead(before, 'zzz')).toBe(before);
  });

  it('never shows a negative bell', () => {
    // The page is bounded; the count is not derived from it. Defensive because the
    // two can disagree if the server's count arrives after a local decrement.
    const before: InboxPage = { items: [item({ id: 'a' })], unreadCount: 0 };
    expect(withItemRead(before, 'a').unreadCount).toBe(0);
  });
});

describe('marking everything read', () => {
  it('clears every dot and takes the count from the server', () => {
    const before = page([item({ id: 'a' }), item({ id: 'b', read: true })]);
    const after = withAllRead(before, 0);

    expect(after.items.every((entry) => entry.read)).toBe(true);
    expect(after.unreadCount).toBe(0);
  });

  it('trusts the server rather than the visible page', () => {
    // One page of a longer inbox: the local list cannot tell you what is left.
    const after = withAllRead(page([item({ id: 'a' })]), 3);
    expect(after.unreadCount).toBe(3);
  });
});

describe('copy', () => {
  it('uses none of the vocabulary §7 forbids', () => {
    const all = Object.values(COPY).join(' ').toLowerCase();
    for (const word of FORBIDDEN_IN_COPY) {
      expect(all).not.toContain(word);
    }
  });

  it('says what will land here rather than "nothing here" (§6)', () => {
    expect(COPY.emptyBody.length).toBeGreaterThan(COPY.emptyTitle.length);
    expect(COPY.emptyBody).toMatch(/you'll see/i);
  });

  it('never implies a run finishes — no COMPLETED state exists in Phase 1 (D1)', () => {
    const all = Object.values(COPY).join(' ').toLowerCase();
    expect(all).not.toMatch(/\b(done|completed|finished)\b/);
  });
});
