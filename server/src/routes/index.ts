// Every API route in one list.
//
// One list, one gate: `buildRouter` compiles these declarations into the
// default-deny gate and mounts it ahead of the handlers, so a route that reaches
// the router without appearing here is rejected rather than served
// (`architecture.md §4.3`).

import type { Router } from 'express';
import { authRoutes } from './auth.js';
import { deviceRoutes } from './devices.js';
import { userRoutes } from './users.js';
import { buildRouter, type RouteDefinition } from './registry.js';

export const apiRoutes: RouteDefinition[] = [
  ...authRoutes,
  ...userRoutes,
  ...deviceRoutes,
];

export function createApiRouter(): Router {
  return buildRouter(apiRoutes);
}
