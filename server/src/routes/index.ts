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
import { deviceRoutes } from './devices.js';
import { donorRoutes } from './donors.js';
import { pickupRouteRoutes } from './pickup-routes.js';
import { pushRoutes } from './push.js';
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
];

export function createApiRouter(): Router {
  return buildRouter(apiRoutes);
}
