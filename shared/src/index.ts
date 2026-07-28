// Types and enum values shared between client and server.
//
// RULE: zero runtime dependencies. Nothing here may import from `server` or pull
// in a runtime module — this package exists so a type-only import from the client
// can never drag the Kysely pool into the browser bundle.
//
// Contents: API request/response shapes, and enum values mirroring the native
// Postgres enums (`data-model.md §1`). Nothing else.

export {};
