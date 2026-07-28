// Browser entry point.
//
// Two jobs and no more: mount the app, and hold the screen registry. Everything
// else lives in `app/`.
//
// THE SCREEN REGISTRY is the one wiring point between the shell and the screens.
// A wave that builds an S1.x screen adds one line here and nothing else; the
// route it answers to is declared in `app/routes.ts`.
//
// The service worker is registered elsewhere: it exists for push only and must
// never adopt a cache-first strategy (`architecture.md §4.5`).

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.tsx';
import type { ScreenRegistry } from './app/AppShell.tsx';
import './tokens/tokens.css';

const SCREENS: ScreenRegistry = {
  // login: LoginScreen,        S1.1
  // board: BoardScreen,        S1.2
  // shift: ShiftDetailScreen,  S1.3
  // …one entry per screen, from `client/src/screens/s1-rescue/`.
};

const container = document.getElementById('root');
if (!container) throw new Error('No #root element in index.html');

createRoot(container).render(
  <StrictMode>
    <App screens={SCREENS} />
  </StrictMode>,
);
