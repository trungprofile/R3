// S1.1 Login — `ui-ux-spec.md §5` and the S1.1 entry.
//
// Two steps and no third: tap your name, then enter your PIN (Volunteer) or your
// password (Staff/Admin). Names are a LIST, not a field, because §1 principle 4 is
// recognition over recall and this population does not want to type an identifier
// into a box. The roster being public is deliberate, not a leak
// (`product-requirement.md §2`); `architecture.md §4.2` defends the PIN by
// throttling instead.
//
// This is the only screen a signed-out person ever sees, so its loading, empty and
// error states are the whole app to someone who cannot get in — all three are
// present, per §3 and §6.
//
// Everything that is a rule rather than a pixel lives in `login.ts`, which has no
// React in it and is tested.

import { useEffect, useRef, useState } from 'react';
import {
  Button,
  EmptyState,
  ErrorBlock,
  List,
  ListItem,
  ListRow,
  NumericKeypad,
  SkeletonRows,
  TextInput,
} from '../../../components/index.ts';
import {
  HOME_PATH,
  useAsyncData,
  useRouter,
  useSession,
  type ScreenProps,
} from '../../../app/index.ts';
import { PIN_LENGTH } from '../../../api/shared.ts';
import type { RosterEntry } from '../../../api/shared.ts';
import { fetchRoster, signIn } from './api.ts';
import {
  afterFailure,
  COPY,
  credentialReady,
  findEntry,
  NO_ATTEMPTS,
  orderRoster,
  rosterName,
  type AttemptState,
} from './login.ts';
import {
  browserStore,
  forget,
  readRemembered,
  rememberAfterSignIn,
  type NameStore,
} from './remembered.ts';
import './login.css';

/** The PIN as it is typed: filled marks, never the digits. Big enough to see from
 *  arm's length, and `aria-hidden` because the count beside it is what a screen
 *  reader should say — "•••" is not speech. */
function PinDots({ length }: { length: number }) {
  return (
    <>
      <div className="r3-login__dots" aria-hidden="true">
        {Array.from({ length: PIN_LENGTH }, (_, index) => (
          <span
            key={index}
            className={`r3-login__dot${index < length ? ' r3-login__dot--filled' : ''}`}
          />
        ))}
      </div>
      <p className="r3-sr-only" role="status">
        {length} of {PIN_LENGTH} digits entered
      </p>
    </>
  );
}

export function LoginScreen(_props: ScreenProps) {
  const { status, onSignedIn } = useSession();
  const { match, navigate } = useRouter();

  const roster = useAsyncData(fetchRoster);
  // Resolved once: `localStorage` throws outright in private browsing, and the
  // guard belongs in one place rather than at every call.
  const [store] = useState<NameStore | null>(() => browserStore());

  const [selected, setSelected] = useState<string | null>(null);
  const [credential, setCredential] = useState('');
  const [attempt, setAttempt] = useState<AttemptState>(NO_ATTEMPTS);
  const [submitting, setSubmitting] = useState(false);

  // A remembered name opens straight on the keypad (§5, personal phone). Once
  // only: "Choose a different name" must not be undone on the next render.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || !roster.data) return;
    restored.current = true;
    const remembered = findEntry(roster.data, readRemembered(store));
    if (remembered) setSelected(remembered.username);
  }, [roster.data, store]);

  // Signing in from `/login` leaves the URL on a screen that is now behind the
  // user. The shell renders this screen for anyone signed out whatever the path,
  // so this only fires for the path that is literally the login screen's.
  useEffect(() => {
    if (status === 'signed-in' && match?.route.id === 'login') {
      navigate(HOME_PATH, { replace: true });
    }
  }, [status, match, navigate]);

  const entries = roster.data ? orderRoster(roster.data) : [];
  const entry = findEntry(entries, selected);

  const choose = (next: RosterEntry) => {
    setSelected(next.username);
    setCredential('');
    setAttempt(NO_ATTEMPTS);
  };

  const back = () => {
    forget(store);
    setSelected(null);
    setCredential('');
    setAttempt(NO_ATTEMPTS);
  };

  const submit = async (who: RosterEntry) => {
    setSubmitting(true);
    try {
      const session = await signIn({ username: who.username, credential });
      // The server's verdict on this device, never a guess here (§4.2).
      rememberAfterSignIn(store, who.username, session.sharedDevice);
      setCredential('');
      setAttempt(NO_ATTEMPTS);
      await onSignedIn();
    } catch (cause) {
      // Clear the entry either way: retyping four digits is cheaper than working
      // out which of the four on screen was wrong.
      setCredential('');
      setAttempt((current) => afterFailure(current, cause));
    } finally {
      setSubmitting(false);
    }
  };

  // --- Step 1: the name list -----------------------------------------------

  if (!entry) {
    return (
      <div className="r3-login">
        <h1 className="r3-login__title">{COPY.chooseTitle}</h1>
        <p className="r3-login__hint">{COPY.chooseHint}</p>
        {roster.showLoading ? <SkeletonRows rows={5} label={COPY.loading} /> : null}
        {roster.error ? <ErrorBlock error={roster.error} onRetry={roster.reload} /> : null}
        {!roster.error && roster.data && entries.length === 0 ? (
          <EmptyState title={COPY.emptyTitle}>{COPY.emptyBody}</EmptyState>
        ) : null}
        {entries.length > 0 ? (
          <List label={COPY.chooseTitle}>
            {entries.map((candidate) => (
              <ListItem key={candidate.id}>
                <ListRow title={rosterName(candidate)} onClick={() => choose(candidate)} />
              </ListItem>
            ))}
          </List>
        ) : null}
      </div>
    );
  }

  // --- Step 2: the credential ----------------------------------------------

  const usesPin = entry.credentialKind === 'PIN';
  const ready = credentialReady(entry.credentialKind, credential);

  return (
    // A real form, so the Return key on a desktop keyboard submits the password
    // rather than doing nothing. The keypad path has no field to press Return in
    // and reaches the same handler through the button.
    <form
      className="r3-login"
      onSubmit={(event) => {
        event.preventDefault();
        void submit(entry);
      }}
    >
      <h1 className="r3-login__title">{rosterName(entry)}</h1>

      {usesPin ? (
        <div className="r3-login__pin">
          <p className="r3-login__hint" id="r3-login-pin-label">
            {COPY.pinLabel}
          </p>
          <PinDots length={credential.length} />
          <NumericKeypad
            value={credential}
            onChange={setCredential}
            maxLength={PIN_LENGTH}
            ariaLabel={COPY.keypadLabel}
            disabled={submitting}
          />
          {attempt.message ? (
            <p className="r3-login__error" role="alert">
              {attempt.message}
            </p>
          ) : null}
        </div>
      ) : (
        <TextInput
          label={COPY.passwordLabel}
          type="password"
          value={credential}
          onChange={setCredential}
          disabled={submitting}
          autoComplete="current-password"
          {...(attempt.message ? { error: attempt.message } : {})}
        />
      )}

      <div className="r3-login__actions">
        {/* The screen's one primary action (§1 principle 1). Disabled rather than
            hidden — §3 prefers hiding, but an Enter button that vanishes while
            you type your PIN is exactly the fragile control §1.5 rules out. */}
        <Button variant="primary" type="submit" block loading={submitting} disabled={!ready}>
          {COPY.submit}
        </Button>
        <Button variant="secondary" block onClick={back} disabled={submitting}>
          {COPY.back}
        </Button>
      </div>
    </form>
  );
}
