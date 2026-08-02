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
import { LoginScreen } from './screens/s1-rescue/s1-1-login/index.ts';
import { BoardScreen } from './screens/s1-rescue/s1-2-board/index.ts';
import { ShiftDetailScreen } from './screens/s1-rescue/s1-3-shift-detail/index.ts';
import { MyShiftsScreen } from './screens/s1-rescue/s1-4-my-shifts/index.ts';
import { PickupScreen } from './screens/s1-rescue/s1-5-pickup/index.ts';
import { ScheduleScreen } from './screens/s1-rescue/s1-6-schedule/index.ts';
import { RescheduleScreen } from './screens/s1-rescue/s1-7-reschedule/index.ts';
import { AdminScreen, MetricsRedirect } from './screens/s1-rescue/s1-8-admin/index.ts';
import { InboxScreen, useUnreadCount } from './screens/s1-rescue/s1-9-inbox/index.ts';
import { RunPickerScreen } from './screens/s2-receive/s2-1b-run-picker/index.ts';
import { WeightEntryScreen } from './screens/s2-receive/s2-2-weight-entry/index.ts';
import { ReceiveDoneScreen } from './screens/s2-receive/s2-2b-receive-done/index.ts';
import { DonationScreen } from './screens/s2-receive/s2-3-donation/index.ts';
import { TruckInboundHost } from './screens/s2-receive/s2-4-truck-inbound/index.ts';
import { ReportScreen } from './screens/s3-report/s3-1-report/index.ts';
import './tokens/tokens.css';

const SCREENS: ScreenRegistry = {
  login: LoginScreen, // S1.1
  board: BoardScreen, // S1.2
  shift: ShiftDetailScreen, // S1.3 — the only route into S1.5 (4b, s1-3's Assumed 1)
  'my-shifts': MyShiftsScreen, // S1.4
  pickup: PickupScreen, // S1.5
  schedule: ScheduleScreen, // S1.6
  reschedule: RescheduleScreen, // S1.7
  admin: AdminScreen, // S1.8
  inbox: InboxScreen, // S1.9
  // Phase 2. S2.4 is deliberately absent: it is a device-level banner that fires
  // regardless of who is logged in (§4), so the shell mounts it beside the offline
  // banner rather than the router resolving it to a route.
  'receive-runs': RunPickerScreen, // S2.1b
  'receive-stop': WeightEntryScreen, // S2.2
  'receive-done': ReceiveDoneScreen, // S2.2b
  donation: DonationScreen, // S2.3
  // Phase 3. The registry is now complete: every screen in `ui-ux-spec.md §8` has
  // an entry, and `AppShell`'s Placeholder is unreachable through the nav.
  report: ReportScreen, // S3.1
  // S3.2 — a redirect, not the screen. D18 made metrics S1.8's first tab, and this
  // route survives only so a saved `/metrics` link still lands on it. The screen
  // itself lives at `s1-8-admin/metrics/` and is mounted by `AdminScreen`.
  metrics: MetricsRedirect, // S3.2
};

linkManifest();
watchForInstallPrompt();

const container = document.getElementById('root');
if (!container) throw new Error('No #root element in index.html');

createRoot(container).render(
  <StrictMode>
    {/* `useUnreadCount` is injected for the same reason as `SCREENS`: it is a
        screen's export, and `app/` must not import from `screens/`. */}
    <App
      screens={SCREENS}
      useUnreadCount={useUnreadCount}
      DeviceAlerts={TruckInboundHost}
    />
  </StrictMode>,
);
