// Browser entry point.
//
// Two jobs and no more: mount the app, and hold the screen registry. Everything
// else lives in `app/`.
//
// THE SCREEN REGISTRY is the one wiring point between the shell and the screens.
// A wave that builds an S1.x screen adds one line here and nothing else; the
// route it answers to is declared in `app/routes.ts`.
//
// The service worker is registered by `pwa/`: it exists for push only and must
// never adopt a cache-first strategy (`architecture.md §4.5`). Registration itself
// waits for sign-in, but the two things below cannot:
//
//   - the manifest link, because installability is not a signed-in concept and the
//     browser evaluates it on load;
//   - the install-prompt listener, because Chromium fires `beforeinstallprompt`
//     early, often before React has mounted, and an unheard event is gone.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.tsx';
import type { ScreenRegistry } from './app/AppShell.tsx';
import { linkManifest, watchForInstallPrompt } from './pwa/index.ts';
import './tokens/tokens.css';

const SCREENS: ScreenRegistry = {
  // login: LoginScreen,        S1.1
  // board: BoardScreen,        S1.2
  // shift: ShiftDetailScreen,  S1.3
  // …one entry per screen, from `client/src/screens/s1-rescue/`.
};

linkManifest();
watchForInstallPrompt();

const container = document.getElementById('root');
if (!container) throw new Error('No #root element in index.html');

createRoot(container).render(
  <StrictMode>
    <App screens={SCREENS} />
  </StrictMode>,
);
