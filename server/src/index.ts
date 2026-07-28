// Process entrypoint. Boots the Express API AND the in-process job scheduler in the
// same process (`architecture.md §4.5`) — there is no separate worker container.
//
// Express also serves the built React SPA with a catch-all fallback to index.html
// for client-side routing. No nginx: under Cloudflare Tunnel there is no TLS to
// terminate locally.
//
// Jobs are catch-up sweeps, never one-shot timers (§4.4): every job asks "what is
// due and unhandled?", so a missed tick self-heals on the next pass rather than
// being lost to a restart.
//
// Deploy note: set `trust proxy` before sessions. The final hop (cloudflared ->
// Express) is plain HTTP, so without it Express believes the connection is insecure
// and silently refuses to set the `Secure` session cookie (§4.2).

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import express, { type Express } from 'express';
import { attachActor } from './middleware/auth.js';
import { errorHandler } from './middleware/error.js';
import { startScheduler } from './jobs/index.js';
import { createApiRouter } from './routes/index.js';

const DEFAULT_CLIENT_DIST = fileURLToPath(new URL('../../client/dist', import.meta.url));

export function createApp(): Express {
  const app = express();

  // FIRST, before anything reads an address or sets a cookie. `trust proxy` is
  // also what makes `req.ips` meaningful, which is how §4.2's per-IP throttle
  // decides whether a forwarded-for header came from the tunnel or from someone
  // who reached the origin directly and forged it.
  app.set('trust proxy', process.env['TRUST_PROXY'] ?? 'loopback');
  app.disable('x-powered-by');

  // Bodies are small: an account form, a login, a weight. A low cap costs nothing
  // and removes a trivially available memory pressure.
  app.use(express.json({ limit: '64kb' }));

  // Identity resolution runs only for the API. Static assets are public and need
  // no actor — and resolving one would mean a session write per image.
  app.use('/api', attachActor, createApiRouter());

  // Static assets are the second thing §4.3 lets declare itself public, and this
  // is that declaration: everything under the client build is served to anyone.
  // The API above is already gated by its own default-deny router, so nothing
  // reachable here carries data.
  const clientDist = process.env['CLIENT_DIST'] ?? DEFAULT_CLIENT_DIST;
  app.use(express.static(clientDist, { index: false }));

  // Catch-all fallback to index.html so client-side routing survives a refresh on
  // a deep link. GET/HEAD only: a POST to an unknown path is a bug, not a page.
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    res.sendFile(path.join(clientDist, 'index.html'), (err) => {
      if (err) next();
    });
  });

  app.use(errorHandler);
  return app;
}

export function start(): void {
  const app = createApp();
  const port = Number(process.env['PORT'] ?? 3000);

  // Wired by the lead at the Wave-1 merge: Express is the identity lane's, `jobs/`
  // is the signal lane's, and neither could import a file absent from its own
  // worktree. Started before `listen` deliberately — jobs are catch-up sweeps
  // (§4.4), so the first tick reconciles whatever the last shutdown left due,
  // and nothing about that depends on the port being open.
  startScheduler();

  app.listen(port, () => {
    console.log(JSON.stringify({ event: 'listening', port }));
  });
}

// Only when run directly — importing this module in a test must not open a port.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start();
}
