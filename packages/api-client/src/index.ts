import createClient, { type Middleware } from 'openapi-fetch';
import type { paths } from './generated/schema';

export interface ClientOptions {
  baseUrl: string;
  /** Returns the bearer token for the current caller (server side: from the session). */
  getToken: () => Promise<string | null> | string | null;
  /** Returns the working school and year, sent as X-School-Id and X-Academic-Year-Id. */
  getContext?: () =>
    | Promise<{ schoolId?: string; academicYearId?: string }>
    | { schoolId?: string; academicYearId?: string };
}

/**
 * The only sanctioned way for front ends to call the API (ADR-007 point 4). Types come from
 * apps/api/openapi.json through `pnpm client:generate`; run it after any API change.
 */
export function createApiClient(options: ClientOptions) {
  const client = createClient<paths>({ baseUrl: `${options.baseUrl}/api/v1` });

  const auth: Middleware = {
    async onRequest({ request }) {
      const token = await options.getToken();
      if (token) request.headers.set('Authorization', `Bearer ${token}`);
      const ctx = options.getContext ? await options.getContext() : {};
      if (ctx.schoolId) request.headers.set('X-School-Id', ctx.schoolId);
      if (ctx.academicYearId) request.headers.set('X-Academic-Year-Id', ctx.academicYearId);
      if (!request.headers.has('X-Request-Id'))
        request.headers.set('X-Request-Id', crypto.randomUUID());
      return request;
    },
  };
  client.use(auth);
  return client;
}

export type ApiClient = ReturnType<typeof createApiClient>;
export type { paths } from './generated/schema';
