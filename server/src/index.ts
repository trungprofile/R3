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

export {};
