// Service worker — registered for PUSH ONLY (`architecture.md §4.5`).
//
// Offline support is an explicit non-goal, and `ui-ux-spec.md §6` requires a
// blocking "You're offline" banner. So this worker must NOT adopt a cache-first
// strategy that lets the app shell load and appear functional without a network —
// that would fake a capability the product deliberately lacks.
//
// Push delivery is at-least-once; a duplicate banner beats a lost reminder. A
// `410 Gone` on dispatch means the subscription is dead (uninstalled, permission
// revoked) and the server deletes the `push_subscription` row — the normal end of
// a subscription's life, not an error.

export {};
