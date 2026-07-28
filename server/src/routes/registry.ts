// The route registry.
//
// A route is a declaration plus a handler, and the declaration is not optional —
// `access` is a required field, so an undeclared route does not typecheck, and if
// one is registered on the router by some other path the gate rejects it anyway
// (`middleware/authorize.ts`). Two independent mechanisms for the same rule,
// because `architecture.md §4.3`'s cost/benefit is explicit: "the cost is one
// declaration per endpoint, and that cost is the point."
//
// Handlers here parse input, call exactly one service function, and shape the
// response. No domain rules live in this directory (`architecture.md §4.1`).

import { Router, type Request, type RequestHandler } from 'express';
import { accessGate, type AccessDeclaration, type HttpMethod } from '../middleware/authorize.js';
import { badRequest } from '../middleware/error.js';

export interface RouteDefinition {
  method: HttpMethod;
  /** Path relative to the API mount point (`/api`). */
  path: string;
  access: AccessDeclaration;
  handler: RequestHandler;
}

/** Identity function whose only job is to make `access` unforgettable at the type
 *  level. Every route in `routes/index.ts` goes through it. */
export function defineRoute(definition: RouteDefinition): RouteDefinition {
  return definition;
}

/** The JSON body as a plain object. Field-level validation belongs to the service
 *  that owns the rule; this only rejects a body that is not an object at all. */
export function body(req: Request): Record<string, unknown> {
  const value: unknown = req.body;
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw badRequest('Expected a JSON object.');
  }
  return value as Record<string, unknown>;
}

/** A required string field. */
export function requiredString(
  source: Record<string, unknown>,
  field: string,
): string {
  const value = source[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw badRequest(`${field} is required.`);
  }
  return value;
}

/** An optional string field; `undefined` when absent, `null` when explicitly
 *  cleared. The difference matters to PATCH. */
export function optionalString(
  source: Record<string, unknown>,
  field: string,
): string | null | undefined {
  const value = source[field];
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') throw badRequest(`${field} must be text.`);
  return value;
}

/** Wrap so a rejected promise reaches the error handler rather than hanging the
 *  request. Express 5 forwards async rejections itself; this is belt and braces
 *  for handlers that throw synchronously inside a promise chain. */
function wrap(handler: RequestHandler): RequestHandler {
  return (req, res, next) => {
    void Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export function buildRouter(routes: readonly RouteDefinition[]): Router {
  const router = Router();

  // The gate first, always. It matches against the declarations, not against what
  // was registered below, so nothing is reachable by being registered earlier.
  router.use(accessGate(routes.map(({ method, path, access }) => ({ method, path, access }))));

  for (const route of routes) {
    router[route.method](route.path, wrap(route.handler));
  }

  return router;
}
