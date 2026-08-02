// Pure-logic tests for S1.1: the throttle copy, what does and does not consume a
// try, the credential gate, and what this browser is allowed to remember.
//
// NOTHING HERE RENDERS. There is no browser or component test harness in this repo
// and adding one (jsdom, a renderer) would be a dependency, which a lane may not
// add (build-plan §3/D5). The screen's decisions were written as functions of
// plain records precisely so they could be tested at all; what is NOT covered is
// stated in this wave's report rather than implied by a green suite.
//
// Run: npx vitest run --root client

import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../api/index.ts';
import type { RosterEntry } from '../../../api/shared.ts';
import { FORBIDDEN_IN_COPY } from '../../../pwa/onboarding.ts';
import {
  afterFailure,
  COPY,
  credentialReady,
  filterRoster,
  findEntry,
  LOCKED_TEXT,
  MAX_TRIES,
  NO_ATTEMPTS,
  orderRoster,
  rosterName,
  triesLeftAfter,
  wrongCredentialText,
} from './login.ts';
import { forget, readRemembered, rememberAfterSignIn, type NameStore } from './remembered.ts';

// The two failures the server actually answers with (`server/src/services/auth.ts`).
const rejected = () =>
  new ApiError('unauthenticated', { status: 401, detail: 'That did not match. Try again.' });
const locked = () => new ApiError('server', { status: 429, detail: LOCKED_TEXT });

function person(over: Partial<RosterEntry> = {}): RosterEntry {
  return {
    id: 'u1',
    username: 'kholt',
    firstName: 'Karen',
    lastName: 'Holt',
    credentialKind: 'PIN',
    ...over,
  };
}

describe('tries left (S1.1: an inline count on a wrong PIN)', () => {
  it('says "3 tries left" on the first wrong PIN', () => {
    // The server locks on the 4th failure, so the 1st leaves 3 — the exact number
    // S1.1's copy names.
    const state = afterFailure(NO_ATTEMPTS, rejected());
    expect(state.failures).toBe(1);
    expect(state.message).toBe("That didn't match. 3 tries left.");
  });

  it('counts down and goes singular at one', () => {
    let state = afterFailure(NO_ATTEMPTS, rejected());
    state = afterFailure(state, rejected());
    expect(state.message).toBe("That didn't match. 2 tries left.");
    state = afterFailure(state, rejected());
    expect(state.message).toBe("That didn't match. 1 try left.");
  });

  it('never counts below zero', () => {
    expect(triesLeftAfter(MAX_TRIES + 5)).toBe(0);
    expect(wrongCredentialText(0)).toBe("That didn't match. Try again.");
  });
});

describe('the soft lock (S1.1, architecture.md §4.2)', () => {
  it('shows the server\'s own sentence, exactly', () => {
    const state = afterFailure(NO_ATTEMPTS, locked());
    expect(state.locked).toBe(true);
    expect(state.message).toBe('Too many tries. Try again in 15 minutes.');
  });

  it('falls back to the same sentence when the 429 carried no body', () => {
    const state = afterFailure(NO_ATTEMPTS, new ApiError('server', { status: 429 }));
    expect(state.message).toBe(LOCKED_TEXT);
  });

  it('never implies a human can unlock the account', () => {
    // The lock always self-clears and there IS no unlock action, so copy sending a
    // volunteer to find staff would send them after help nobody can give.
    expect(LOCKED_TEXT).not.toMatch(/staff|admin|unlock|contact|call/i);
  });

  it('restarts the count, because the server\'s counter restarts too', () => {
    let state = afterFailure(NO_ATTEMPTS, rejected());
    state = afterFailure(state, rejected());
    state = afterFailure(state, rejected());
    state = afterFailure(state, locked());
    expect(state.failures).toBe(0);

    // Once the lock lapses, the next wrong PIN is the first failure again.
    state = afterFailure(state, rejected());
    expect(state.message).toBe("That didn't match. 3 tries left.");
  });
});

describe('what does not consume a try', () => {
  it('an offline attempt, which never reached the server', () => {
    const state = afterFailure({ failures: 1, locked: false, message: null }, new ApiError('offline'));
    expect(state.failures).toBe(1);
    expect(state.message).toBe("You're offline. R3 needs a connection.");
  });

  it('a server fault, which never reached the credential comparison', () => {
    const state = afterFailure(
      { failures: 2, locked: false, message: null },
      new ApiError('server', { status: 500, detail: 'Something went wrong. Try again.' }),
    );
    expect(state.failures).toBe(2);
  });

  it('a rejected request shape, shown in the server\'s own words', () => {
    const state = afterFailure(
      NO_ATTEMPTS,
      new ApiError('invalid', { status: 400, detail: 'A volunteer PIN is exactly 4 digits.' }),
    );
    expect(state.failures).toBe(0);
    expect(state.message).toBe('A volunteer PIN is exactly 4 digits.');
  });

  it('never shows a correlation id (§6: never a code)', () => {
    const state = afterFailure(
      NO_ATTEMPTS,
      new ApiError('server', { status: 500, correlationId: 'c0ffee' }),
    );
    expect(state.message).not.toContain('c0ffee');
  });
});

describe('the credential gate (communication only — the server re-checks)', () => {
  it('wants exactly four digits for a PIN', () => {
    expect(credentialReady('PIN', '1234')).toBe(true);
    expect(credentialReady('PIN', '123')).toBe(false);
    expect(credentialReady('PIN', '12345')).toBe(false);
    expect(credentialReady('PIN', '12a4')).toBe(false);
    expect(credentialReady('PIN', '')).toBe(false);
  });

  it('wants only something for a password', () => {
    // Not the server's minimum length: an account created before that minimum must
    // still be able to sign in, and the server owns the rule either way.
    expect(credentialReady('PASSWORD', 'a')).toBe(true);
    expect(credentialReady('PASSWORD', '   ')).toBe(false);
    expect(credentialReady('PASSWORD', '')).toBe(false);
  });
});

describe('the name list', () => {
  it('orders by first name, then last', () => {
    const list = [
      person({ id: '1', username: 'kholt', firstName: 'Karen', lastName: 'Holt' }),
      person({ id: '2', username: 'adiaz', firstName: 'Ana', lastName: 'Diaz' }),
      person({ id: '3', username: 'kbell', firstName: 'Karen', lastName: 'Bell' }),
    ];
    expect(orderRoster(list).map((entry) => entry.username)).toEqual(['adiaz', 'kbell', 'kholt']);
  });

  it('does not mutate the roster it was handed', () => {
    const list = [person({ username: 'b', firstName: 'Bea' }), person({ username: 'a', firstName: 'Al' })];
    orderRoster(list);
    expect(list[0]?.username).toBe('b');
  });

  it('names a person by their name, never their username (§1.4, §7)', () => {
    expect(rosterName(person())).toBe('Karen Holt');
    expect(rosterName(person())).not.toContain('kholt');
  });

  it('filters on what is displayed, in either case', () => {
    const list = [
      person({ id: '1', username: 'kholt', firstName: 'Karen', lastName: 'Holt' }),
      person({ id: '2', username: 'adiaz', firstName: 'Ana', lastName: 'Diaz' }),
    ];
    expect(filterRoster(list, 'kar').map(rosterName)).toEqual(['Karen Holt']);
    expect(filterRoster(list, 'KAR').map(rosterName)).toEqual(['Karen Holt']);
    // A substring anywhere, so a last name finds someone too.
    expect(filterRoster(list, 'diaz').map(rosterName)).toEqual(['Ana Diaz']);
    // Across the space, because it matches the name as one displayed string.
    expect(filterRoster(list, 'karen h').map(rosterName)).toEqual(['Karen Holt']);
  });

  it('shows everyone when nothing is typed, and matches nobody on a miss', () => {
    const list = [person(), person({ id: '2', username: 'adiaz', firstName: 'Ana' })];
    expect(filterRoster(list, '')).toHaveLength(2);
    // Trailing space from a phone keyboard must not empty the list.
    expect(filterRoster(list, '  ')).toHaveLength(2);
    expect(filterRoster(list, 'zz')).toEqual([]);
  });

  it('never matches on the username, which is not what is on screen (§1.4, §7)', () => {
    // Typing an identifier is the recall this screen exists to avoid, and a name
    // appearing for text nobody can see reads as a bug.
    expect(filterRoster([person()], 'kholt')).toEqual([]);
  });

  it('does not mutate the roster it was handed', () => {
    const list = [person({ username: 'b', firstName: 'Bea' }), person({ username: 'a', firstName: 'Al' })];
    expect(filterRoster(list, '')).not.toBe(list);
    filterRoster(list, 'al');
    expect(list).toHaveLength(2);
  });

  it('finds the selected entry, and survives a name that is no longer on the roster', () => {
    const list = [person()];
    expect(findEntry(list, 'kholt')?.id).toBe('u1');
    expect(findEntry(list, 'gone')).toBeNull();
    expect(findEntry(null, 'kholt')).toBeNull();
    expect(findEntry(list, null)).toBeNull();
  });
});

describe('the remembered name (§5: personal phone only)', () => {
  function store(): NameStore & { data: Map<string, string> } {
    const data = new Map<string, string>();
    return {
      data,
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => void data.set(key, value),
      removeItem: (key) => void data.delete(key),
    };
  }

  it('remembers the name after a personal-device sign-in', () => {
    const s = store();
    rememberAfterSignIn(s, 'kholt', false);
    expect(readRemembered(s)).toBe('kholt');
  });

  it('erases it after a SHARED-device sign-in', () => {
    // The tablet on the counter must never open on the last person's name.
    const s = store();
    rememberAfterSignIn(s, 'kholt', false);
    rememberAfterSignIn(s, 'rmoss', true);
    expect(readRemembered(s)).toBeNull();
  });

  it('forgets on "choose a different name", so it is never a dead end', () => {
    const s = store();
    rememberAfterSignIn(s, 'kholt', false);
    forget(s);
    expect(readRemembered(s)).toBeNull();
  });

  it('does nothing at all when the browser has no storage', () => {
    // Safari in private browsing. A login screen that cannot render is worse than
    // one that forgets.
    expect(() => rememberAfterSignIn(null, 'kholt', false)).not.toThrow();
    expect(() => forget(null)).not.toThrow();
    expect(readRemembered(null)).toBeNull();
  });
});

describe('microcopy (§7)', () => {
  const everything = [
    ...Object.values(COPY),
    LOCKED_TEXT,
    wrongCredentialText(3),
    wrongCredentialText(1),
    wrongCredentialText(0),
  ];

  it('uses none of the forbidden vocabulary', () => {
    for (const text of everything) {
      for (const word of FORBIDDEN_IN_COPY) {
        expect(text.toLowerCase()).not.toContain(word);
      }
    }
  });

  it('shows no identifier and no code anywhere', () => {
    for (const text of everything) {
      expect(text).not.toMatch(/username|error [a-z0-9]+|\bcode\b/i);
    }
  });

  it('uses no dashes as punctuation — two sentences or a comma instead', () => {
    for (const text of everything) {
      expect(text).not.toMatch(/[—–]/);
    }
  });

  it('keeps the exact strings the filtered list and the empty roster depend on', () => {
    // The two "nothing to show" states are different problems and must not read
    // the same: one is fixed by typing less, the other by an admin.
    expect(COPY.noMatch).toBe('No names match.');
    expect(COPY.emptyBody).toBe('Ask an admin to add your account.');
    expect(COPY.searchLabel).toBe('Find your name');
  });
});
