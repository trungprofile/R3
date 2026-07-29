// Pure-logic tests for the onboarding flow: which card a given browser lands on,
// what the copy is allowed to say, and the two conversions that are silently wrong
// rather than loudly wrong when they break.
//
// NOTHING HERE RENDERS. There is no browser or component test harness in this repo
// and adding one (jsdom, a renderer) would be a dependency, which a lane may not
// add (build-plan §3/D5). So the decisions were written as functions of plain
// records precisely so they could be tested at all — and what is NOT covered is
// stated in this wave's report rather than implied by a green suite.
//
// Run: npx vitest run --root client

import { describe, expect, it } from 'vitest';
import { urlBase64ToUint8Array } from './alerts.ts';
import {
  clearDismissed,
  readDismissed,
  rememberDismissed,
  type DismissalStore,
} from './dismissal.ts';
import {
  alertsAreOn,
  COPY,
  FORBIDDEN_IN_COPY,
  visibleStep,
  type OnboardingInput,
  type OnboardingStep,
} from './onboarding.ts';
import { detectInstalled, detectPlatform, deviceLabel } from './platform.ts';

// ---------------------------------------------------------------------------

function browser(over: Partial<OnboardingInput> = {}): OnboardingInput {
  return {
    platform: 'android',
    installed: true,
    alertsSupported: true,
    permission: 'default',
    registered: false,
    keyConfigured: true,
    ...over,
  };
}

const IOS_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const IPADOS =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';
const DESKTOP_CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const MAC_SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';

describe('platform detection (§5: show the matching 2-step guide)', () => {
  it('recognises an iPhone', () => {
    expect(detectPlatform(IOS_SAFARI, 5)).toBe('ios');
  });

  it('recognises an iPad, which claims to be a Mac', () => {
    // iPadOS 13+ reports "Macintosh"; the touch screen is the only tell. Getting
    // this wrong would show an iPad user the Android guide — and iOS is the one
    // platform where the guide is a precondition for alerts at all.
    expect(detectPlatform(IPADOS, 5)).toBe('ios');
  });

  it('does not mistake a desktop Mac for an iPad', () => {
    expect(detectPlatform(MAC_SAFARI, 0)).toBe('other');
  });

  it('recognises Android', () => {
    expect(detectPlatform(ANDROID_CHROME, 5)).toBe('android');
  });

  it('treats everything else as neither', () => {
    expect(detectPlatform(DESKTOP_CHROME, 0)).toBe('other');
  });

  it('reads installed from either the standard or the iOS-only signal', () => {
    expect(detectInstalled(true, undefined)).toBe(true);
    expect(detectInstalled(false, true)).toBe(true);
    expect(detectInstalled(false, false)).toBe(false);
    expect(detectInstalled(false, undefined)).toBe(false);
  });

  it('labels a registration for whoever reads the table later', () => {
    expect(deviceLabel('ios', true)).toBe('iPhone or iPad (home screen)');
    expect(deviceLabel('android', false)).toBe('Android phone');
    expect(deviceLabel('other', false)).toBe('Computer');
  });
});

describe('alerts are on only when both halves are true', () => {
  it('needs permission AND a registration', () => {
    expect(alertsAreOn(browser({ permission: 'granted', registered: true }))).toBe(true);
    // The silent failure §5's chip exists to expose: permission granted, nothing
    // registered, so nothing is ever delivered.
    expect(alertsAreOn(browser({ permission: 'granted', registered: false }))).toBe(false);
    expect(alertsAreOn(browser({ permission: 'default', registered: true }))).toBe(false);
  });
});

describe('which card a browser lands on', () => {
  const cases: [string, OnboardingInput, OnboardingStep][] = [
    [
      'iPhone in a tab — install first, because iOS cannot alert before that',
      browser({ platform: 'ios', installed: false, alertsSupported: false, permission: 'unsupported' }),
      'install-ios',
    ],
    [
      'iPhone on the home screen — now the alerts prompt',
      browser({ platform: 'ios', installed: true }),
      'enable-alerts',
    ],
    [
      'Android in a tab — the guide comes first',
      browser({ platform: 'android', installed: false }),
      'install-android',
    ],
    [
      'Android on the home screen — the alerts prompt',
      browser({ platform: 'android', installed: true }),
      'enable-alerts',
    ],
    [
      'desktop — no install guide, §5 scopes it to the phone',
      browser({ platform: 'other', installed: false }),
      'enable-alerts',
    ],
    [
      'permission already refused — say what to do about it',
      browser({ permission: 'denied' }),
      'blocked',
    ],
    [
      'alerts already on — nothing to ask',
      browser({ permission: 'granted', registered: true }),
      'none',
    ],
    [
      'a browser that cannot do alerts at all — ask for nothing',
      browser({ platform: 'other', alertsSupported: false, permission: 'unsupported' }),
      'none',
    ],
    [
      'a box with no keys — nothing the volunteer can act on',
      browser({ platform: 'other', keyConfigured: false }),
      'none',
    ],
  ];

  for (const [name, input, expected] of cases) {
    it(name, () => {
      expect(visibleStep(input)).toBe(expected);
    });
  }
});

describe('dismissal never dead-ends the flow', () => {
  it('lets an Android user skip the guide and still be offered alerts', () => {
    const input = browser({ platform: 'android', installed: false });
    expect(visibleStep(input, ['install-android'])).toBe('enable-alerts');
  });

  it('ends the flow on iOS, where alerts are impossible before installing', () => {
    const input = browser({
      platform: 'ios',
      installed: false,
      alertsSupported: false,
      permission: 'unsupported',
    });
    // Offering "turn on alerts" here would be offering a button that cannot work.
    expect(visibleStep(input, ['install-ios'])).toBe('none');
  });

  it('hides a dismissed alerts prompt without turning anything on', () => {
    const input = browser({ platform: 'other' });
    expect(visibleStep(input, ['enable-alerts'])).toBe('none');
    expect(alertsAreOn(input)).toBe(false);
  });

  it('hides a dismissed blocked card', () => {
    expect(visibleStep(browser({ permission: 'denied' }), ['blocked'])).toBe('none');
  });
});

describe('remembering what was waved away', () => {
  function fakeStore(): DismissalStore {
    const map = new Map<string, string>();
    return {
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => void map.set(k, v),
      removeItem: (k) => void map.delete(k),
    };
  }

  it('round-trips and never duplicates', () => {
    const store = fakeStore();
    expect(readDismissed(store)).toEqual([]);
    rememberDismissed(store, 'enable-alerts');
    rememberDismissed(store, 'enable-alerts');
    expect(readDismissed(store)).toEqual(['enable-alerts']);
  });

  it('tapping the chip to fix alerts clears everything', () => {
    const store = fakeStore();
    rememberDismissed(store, 'install-android');
    rememberDismissed(store, 'enable-alerts');
    expect(clearDismissed(store)).toEqual([]);
    expect(readDismissed(store)).toEqual([]);
  });

  it('survives a browser with no usable storage', () => {
    // Safari in private browsing. A card that cannot be dismissed is worse than
    // one that reappears next visit.
    expect(readDismissed(null)).toEqual([]);
    expect(rememberDismissed(null, 'enable-alerts')).toEqual(['enable-alerts']);
    expect(clearDismissed(null)).toEqual([]);
  });

  it('ignores corrupted storage rather than throwing on start', () => {
    const store = fakeStore();
    store.setItem('r3.alerts.dismissed', 'not json');
    expect(readDismissed(store)).toEqual([]);
  });
});

describe('the copy obeys §7', () => {
  const strings = Object.values(COPY).flatMap((copy) => [
    copy.title,
    copy.body,
    copy.reassurance,
    copy.dismiss,
    ...(copy.action ? [copy.action] : []),
    ...(copy.steps ?? []),
  ]);

  it('never uses a forbidden word', () => {
    for (const text of strings) {
      for (const word of FORBIDDEN_IN_COPY) {
        expect(text.toLowerCase(), text).not.toContain(word);
      }
    }
  });

  it('never implies the app needs alerts to work', () => {
    // §5: "the app is fully usable with alerts off, and the copy must never imply
    // otherwise." Every card points at the inbox, which is the source of truth
    // regardless of push (PRD channel strategy).
    for (const copy of Object.values(COPY)) {
      expect(copy.reassurance.toLowerCase()).toContain('inbox');
    }
  });

  it('tells an iPhone user plainly that installing comes first', () => {
    expect(COPY['install-ios'].body.toLowerCase()).toContain('only way');
  });

  it('gives each install guide exactly two steps (§5)', () => {
    expect(COPY['install-ios'].steps).toHaveLength(2);
    expect(COPY['install-android'].steps).toHaveLength(2);
  });
});

describe('the key conversion', () => {
  it('decodes base64url, including the characters base64 would get wrong', () => {
    // '-' and '_' are the two substitutions; a conversion that misses them
    // produces a registration the push service accepts and nothing can deliver to.
    const bytes = urlBase64ToUint8Array('-_8');
    expect([...bytes]).toEqual([251, 255]);
  });

  it('tolerates missing padding', () => {
    expect([...urlBase64ToUint8Array('QQ')]).toEqual([65]);
    expect([...urlBase64ToUint8Array('QQ==')]).toEqual([65]);
  });
});
