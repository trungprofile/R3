// The client's door into `shared/src` — the type vocabulary both halves speak.
//
// WHY THIS FILE EXISTS AND NOT A BARE `@r3/shared` IMPORT. Agents build R3 in
// git worktrees that share one `node_modules` by symlink (build-plan §3), so
// `node_modules/@r3/shared` resolves to the MAIN checkout's `shared/src`, not to
// the one in the worktree doing the work. A lane editing `shared/src/index.ts`
// therefore typechecks its client against a DIFFERENT FILE than the one it is
// writing — silently, and only until merge. `phase-1-state.md` A34 recorded that
// for the server half, which imports by relative path for exactly this reason;
// this is the same fix for the browser half, in one place instead of five.
//
// Relative and explicit `.ts`: `client/tsconfig.json` sets
// `allowImportingTsExtensions`, and Vite resolves workspace source across
// package boundaries. `shared` has zero runtime dependencies, so nothing follows
// it into the browser bundle.

export * from '../../../shared/src/index.ts';
