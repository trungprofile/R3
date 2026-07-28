// Error envelope and the terminal error handler (`architecture.md §5.5`).
//
// Unhandled errors return a generic message with a correlation identifier; the
// detail goes to the logs and never to the client. `ui-ux-spec.md §6` requires
// plain, recoverable, code-free error text — the correlation id is for the
// operator reading logs, not the volunteer reading the screen.
//
// `AppError` lives here, with the code that maps it to a response, and services
// throw it. A service raising "this user has history, so it was deactivated
// instead" knows the domain fact; only this file decides it is a 409.

import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { ApiError } from '../../../shared/src/index.js';

/** An error whose message and status are safe to show a client. */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: Record<string, unknown>) =>
  new AppError(400, 'BAD_REQUEST', message, details);

export const notFound = (message = 'Not found') => new AppError(404, 'NOT_FOUND', message);

export const conflict = (message: string, details?: Record<string, unknown>) =>
  new AppError(409, 'CONFLICT', message, details);

export const forbidden = (message = 'You do not have access to that.') =>
  new AppError(403, 'FORBIDDEN', message);

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(err);
    return;
  }

  if (err instanceof AppError) {
    const body: ApiError & Record<string, unknown> = {
      error: err.code,
      message: err.message,
      ...(err.details ?? {}),
    };
    res.status(err.status).json(body);
    return;
  }

  // A malformed body is rejected by `express.json()` before any handler runs, and
  // it carries its own 4xx status. That is a bad request, not a bug: it must not
  // become a 500 with a correlation id pointing at nothing.
  const thrownStatus = (err as { status?: unknown; statusCode?: unknown } | null)?.status;
  if (typeof thrownStatus === 'number' && thrownStatus >= 400 && thrownStatus < 500) {
    const body: ApiError = {
      error: 'BAD_REQUEST',
      message: 'Could not read that request. Try again.',
    };
    res.status(400).json(body);
    return;
  }

  // Anything else is a bug. The client gets a correlation id and nothing else;
  // the stack goes to stdout, structured, per §5.4.
  const correlationId = randomUUID();
  console.error(
    JSON.stringify({
      event: 'unhandled_error',
      correlationId,
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    }),
  );

  const body: ApiError = {
    error: 'INTERNAL',
    message: 'Something went wrong. Try again.',
    correlationId,
  };
  res.status(500).json(body);
}
