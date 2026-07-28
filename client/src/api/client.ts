// The one way the client talks to the server. Every screen goes through here.
//
// What it owns:
//   - carrying the session cookie (`credentials: 'same-origin'`; the cookie is
//     httpOnly + Secure + SameSite per `architecture.md §4.2`, so the client can
//     neither read nor set it — it only has to stop suppressing it)
//   - turning every failure into one `ApiError` shape (§6: plain, recoverable,
//     never a code)
//   - noticing that the network is gone, which raises the blocking banner (§6)
//
// What it deliberately does NOT own: retries. `ui-ux-spec.md §6` makes retry a
// visible, user-initiated affordance ("Tap to try again"), not something that
// silently happens three times behind a spinner.

import { ApiError, kindForStatus } from './errors.ts';
import { reportNetworkFailure, reportNetworkSuccess, isOnline } from './connection.ts';
import { reportActivity } from './activity.ts';

/** Same origin: Express serves the API and the built SPA from one process
 *  (`architecture.md §4.5`). */
const BASE_PATH = '/api';

export interface RequestOptions {
  /** JSON body. Serialized here; do not pre-stringify. */
  body?: unknown;
  /** Query string values. `undefined` entries are dropped. */
  query?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
}

interface ErrorBody {
  message?: unknown;
  correlationId?: unknown;
}

function buildUrl(path: string, query: RequestOptions['query']): string {
  const url = `${BASE_PATH}${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

async function readErrorBody(response: Response): Promise<ErrorBody> {
  try {
    const parsed: unknown = await response.json();
    return parsed && typeof parsed === 'object' ? (parsed as ErrorBody) : {};
  } catch {
    return {};
  }
}

async function send<T>(method: string, path: string, options: RequestOptions): Promise<T> {
  // Cheap pre-check: if the browser already knows there is no link, fail with the
  // offline error rather than spending a timeout on it. Not a guarantee — a
  // request can still die mid-flight below.
  if (!isOnline()) throw new ApiError('offline');

  const hasBody = options.body !== undefined;
  let response: Response;
  try {
    response = await fetch(buildUrl(path, options.query), {
      method,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(hasBody ? { body: JSON.stringify(options.body) } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (cause) {
    // An aborted request is the caller's own doing (unmounted screen, replaced
    // search) and must not be mistaken for a dead network.
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    reportNetworkFailure();
    throw new ApiError('offline');
  }

  reportNetworkSuccess();
  // A request the server accepted slid `last_seen_at` (`architecture.md §4.2`);
  // a rejected one did not. Only the former counts as activity.
  if (response.ok) reportActivity();

  if (!response.ok) {
    const body = await readErrorBody(response);
    throw new ApiError(kindForStatus(response.status), {
      status: response.status,
      ...(typeof body.correlationId === 'string' ? { correlationId: body.correlationId } : {}),
      ...(typeof body.message === 'string' ? { detail: body.message } : {}),
    });
  }

  if (response.status === 204) return undefined as T;

  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiError('server', { status: response.status });
  }
}

export const api = {
  get: <T>(path: string, options: RequestOptions = {}): Promise<T> => send<T>('GET', path, options),
  post: <T>(path: string, options: RequestOptions = {}): Promise<T> =>
    send<T>('POST', path, options),
  patch: <T>(path: string, options: RequestOptions = {}): Promise<T> =>
    send<T>('PATCH', path, options),
  delete: <T>(path: string, options: RequestOptions = {}): Promise<T> =>
    send<T>('DELETE', path, options),
};
