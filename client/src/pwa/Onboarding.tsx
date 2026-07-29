// The §5 onboarding card. One card, one question, one primary action.
//
// It is a CARD, not a screen and not a modal: `ui-ux-spec.md §5` describes a
// one-card guide and a single prompt, and the PRD is explicit that the app is fully
// usable with alerts off. Blocking the app to ask for a permission it does not need
// would contradict both. It sits at the bottom, above the phone's bottom nav, and
// every state can be waved away.
//
// Copy lives in `onboarding.ts` beside the machine that chooses it, so a test can
// hold all of it to §7's forbidden-word list at once.

import { Button, Card } from '../components/index.ts';
import { COPY, type OnboardingStep } from './onboarding.ts';
import type { PwaValue } from './usePwa.ts';
import './pwa.css';

/** Only two outcomes say something the card itself does not. §6: what happened,
 *  what to do, never a code. */
const OUTCOME_TEXT: Partial<Record<string, string>> = {
  failed: 'Could not turn alerts on. Tap to try again.',
  unavailable: 'Alerts are not set up on this system yet.',
};

function Steps({ steps }: { steps: [string, string] }) {
  return (
    <ol className="r3-onboarding__steps">
      {steps.map((text, index) => (
        <li key={text} className="r3-onboarding__step">
          <span className="r3-onboarding__step-number" aria-hidden="true">
            {index + 1}
          </span>
          <span>{text}</span>
        </li>
      ))}
    </ol>
  );
}

export interface OnboardingCardProps {
  pwa: PwaValue;
}

export function OnboardingCard({ pwa }: OnboardingCardProps) {
  const step: OnboardingStep = pwa.step;
  if (step === 'none') return null;

  const copy = COPY[step];
  const outcomeText = pwa.outcome ? OUTCOME_TEXT[pwa.outcome] : undefined;

  // The Android guide's one-tap install exists only where Chromium offered it; the
  // written two steps are always there, because they are the only route on every
  // other browser.
  const showInstallButton = step === 'install-android' && pwa.canPromptInstall;
  const showEnableButton = step === 'enable-alerts' || step === 'blocked';

  return (
    <div className="r3-onboarding" role="region" aria-label={copy.title}>
      <Card>
        <h2 className="r3-onboarding__title">{copy.title}</h2>
        <p className="r3-onboarding__body">{copy.body}</p>
        {copy.steps ? <Steps steps={copy.steps} /> : null}
        {outcomeText ? (
          <p className="r3-onboarding__problem" role="status">
            {outcomeText}
          </p>
        ) : null}
        <p className="r3-onboarding__reassurance">{copy.reassurance}</p>

        <div className="r3-onboarding__actions">
          {showInstallButton ? (
            <Button variant="primary" loading={pwa.busy} onClick={() => void pwa.install()}>
              {copy.action}
            </Button>
          ) : null}
          {showEnableButton ? (
            <Button variant="primary" loading={pwa.busy} onClick={() => void pwa.enable()}>
              {copy.action}
            </Button>
          ) : null}
          <Button variant="secondary" onClick={pwa.dismiss}>
            {copy.dismiss}
          </Button>
        </div>
      </Card>
    </div>
  );
}
