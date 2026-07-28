// The default-deny gate (`architecture.md §4.3`).
//
// "Every route declares its tier/duty requirement; a route declaring nothing is
// rejected, not open. Login and static assets declare themselves public
// explicitly."
//
// This is enforced by CONSTRUCTION rather than by review. The gate does not read
// the handler table Express built — it reads the DECLARATION table, and a request
// whose method and path match no declaration is rejected here, before any handler
// runs. Registering a handler without declaring it therefore produces a 403 on the
// first test rather than an endpoint that silently works for anonymous traffic.
//
// Two comparisons, two different kinds (`architecture.md §4.3` implementation
// note): tier is hierarchical (`>=` on rank), duty is set membership. Writing
// either as equality is the easy bug, so neither is written at a call site — both
// go through `@r3/shared`.

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { hasAnyDuty, tierAtLeast, type ApiError, type Duty, type Tier } from '../../../shared/src/index.js';

/**
 * What a route requires. There is no "no requirement" variant: the only way to be
 * reachable without a session is to say `{ public: true }` out loud.
 */
export type AccessDeclaration =
  | { public: true }
  /** Minimum tier, plus optionally a duty the actor must hold at least one of.
   *  `{ tier: 'VOLUNTEER' }` means "any signed-in user" — every account is at
   *  least a Volunteer (I1). */
  | { tier: Tier; anyDuty?: readonly Duty[] };

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

export interface AccessRule {
  method: HttpMethod;
  /** Path relative to the router's mount point, `:param` for a segment. */
  path: string;
  access: AccessDeclaration;
}

interface CompiledRule extends AccessRule {
  pattern: RegExp;
}

function compile(path: string): RegExp {
  const segments = path.split('/').filter((s) => s.length > 0);
  const body = segments
    .map((segment) =>
      segment.startsWith(':')
        ? '[^/]+'
        : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    )
    .join('/');
  return new RegExp(`^/${body}/?$`);
}

function deny(res: Response, status: number, error: string, message: string): void {
  const body: ApiError = { error, message };
  res.status(status).json(body);
}

/**
 * Build the gate for one router. Mount it BEFORE the handlers, so nothing can be
 * reached by being registered first.
 */
export function accessGate(rules: readonly AccessRule[]): RequestHandler {
  const compiled: CompiledRule[] = rules.map((rule) => ({
    ...rule,
    pattern: compile(rule.path),
  }));

  return function gate(req: Request, res: Response, next: NextFunction): void {
    // Express answers HEAD from a GET handler, so it must resolve to the same
    // declaration rather than falling through to the default deny.
    const method = (req.method === 'HEAD' ? 'GET' : req.method).toLowerCase();
    const rule = compiled.find((r) => r.method === method && r.pattern.test(req.path));

    if (!rule) {
      // The whole point of §4.3. An undeclared route is not open; it does not
      // exist as far as the gate is concerned, and forgetting the declaration
      // fails loudly instead of quietly.
      deny(res, 403, 'UNDECLARED_ROUTE', 'You do not have access to that.');
      return;
    }

    if ('public' in rule.access) {
      next();
      return;
    }

    const actor = req.actor;
    if (!actor) {
      deny(res, 401, 'UNAUTHENTICATED', 'Sign in to continue.');
      return;
    }

    // I1 — hierarchical. Requiring STAFF admits ADMIN.
    if (!tierAtLeast(actor.tier, rule.access.tier)) {
      deny(res, 403, 'FORBIDDEN', 'You do not have access to that.');
      return;
    }

    // I2 — set membership. Holding REPORT implies nothing about DRIVE.
    const required = rule.access.anyDuty;
    if (required && required.length > 0 && !hasAnyDuty(actor.duties, required)) {
      deny(res, 403, 'FORBIDDEN', 'You do not have access to that.');
      return;
    }

    next();
  };
}
