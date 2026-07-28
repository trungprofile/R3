// PII shaping — the sole path by which an `app_user` record reaches a response.
//
// Rule (`architecture.md §4.3`, `product-requirement.md §2`): phone and address are
// visible when `viewer.tier >= STAFF` OR `viewer.id === subject.id`. Name is never
// gated — names are public-within-org by design, shown on the login screen and the
// shared shift board.
//
// Fields are removed on the way OUT, not by per-viewer queries. Per-viewer queries
// would keep PII out of process memory but multiply query variants and leak the
// moment one is missed. This holds one rule in one place — and is safe ONLY because
// it is the single exit path. Every response carrying a user record calls through
// here.
//
// SCOPE, deliberately: "PII" in R3 means phone and address on a *person*. Donor
// `address` and `contact` (`data-model.md §90-91`) are NOT PII and must NOT be
// trimmed — the donor address is the pickup location drivers navigate to, and it
// renders live through the shift-stop snapshot's FK (`data-model.md §233`).
// Anything filed here that is not app_user gating is misfiled.

export {};
