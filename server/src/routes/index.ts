// Every API route in one list.
//
// One list, one gate: `buildRouter` compiles these declarations into the
// default-deny gate and mounts it ahead of the handlers, so a route that reaches
// the router without appearing here is rejected rather than served
// (`architecture.md §4.3`).

import type { Router } from 'express';
import { authRoutes } from './auth.js';
import { availabilityRoutes } from './availability.js';
import { categoryRoutes } from './categories.js';
import { coverageRoutes } from './coverage.js';
import { deviceRoutes } from './devices.js';
import { donorRoutes } from './donors.js';
import { executionRoutes } from './execution.js';
import { pickupRouteRoutes } from './pickup-routes.js';
import { pushRoutes } from './push.js';
import { shiftRoutes } from './shifts.js';
import { truckRoutes } from './trucks.js';
import { userRoutes } from './users.js';
import { buildRouter, type RouteDefinition } from './registry.js';

export const apiRoutes: RouteDefinition[] = [
  ...authRoutes,
  ...userRoutes,
  ...deviceRoutes,
  // Wave 2. Each lane built and tested its own module against `buildRouter()`
  // directly; this list is the lead's seam, so a lane could never mount itself.
  ...donorRoutes,
  ...truckRoutes,
  ...categoryRoutes,
  ...pickupRouteRoutes,
  ...availabilityRoutes,
  ...pushRoutes,
  // Wave 3. All three lanes mount under `/shifts`, so the lead checked the merged
  // list for a shadowed declaration before wiring it: Express resolves two identical
  // method+path pairs to whichever registered FIRST and the second becomes dead code
  // — silently, with no error and nothing in `gate.sh` to catch it (A108). All 24
  // pairs across the three modules are distinct; verified at merge, not assumed.
  ...shiftRoutes,
  ...coverageRoutes,
  ...executionRoutes,
];

export function createApiRouter(): Router {
  return buildRouter(apiRoutes);
}
