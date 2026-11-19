import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { FastifyInstance } from 'fastify';
import type { ContextualRequest } from './request-context';

/** A token known only to this process: an internal call carries it (and is not rate-limited); no client has it. */
const TOKEN = randomBytes(32).toString('hex');
const HEADER = 'x-edupro-internal';

/** True for a request this process made to itself with {@link InternalCalls}. */
export function isInternalCall(req: { headers: Record<string, unknown> }): boolean {
  const v = req.headers[HEADER];
  return (
    typeof v === 'string' &&
    v.length === TOKEN.length &&
    timingSafeEqual(Buffer.from(v), Buffer.from(TOKEN))
  );
}

export interface InternalAnswer {
  status: number;
  body: unknown;
}

/**
 * Calls one of the API's own routes in-process, as the person making the current request (their sign-in and
 * school): every guard, check, validation and audit of that route applies exactly as when a web app calls it. Used
 * where one endpoint gathers others (the approvals inbox, docs/design/89 §5.4) so their rules stay in one place.
 */
@Injectable()
export class InternalCalls {
  constructor(private readonly host: HttpAdapterHost) {}

  async call(
    req: ContextualRequest,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH',
    url: string,
    payload?: unknown,
  ): Promise<InternalAnswer> {
    const fastify = this.host.httpAdapter.getInstance<FastifyInstance>();
    const headers: Record<string, string> = { [HEADER]: TOKEN };
    for (const h of ['authorization', 'x-school-id', 'x-academic-year-id', 'x-request-id']) {
      const v = req.headers[h];
      if (typeof v === 'string') headers[h] = v;
    }
    if (payload !== undefined) headers['content-type'] = 'application/json';
    const r = await fastify.inject({
      method,
      url: `/api/v1${url}`,
      headers,
      ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
    });
    let body: unknown = r.body;
    try {
      body = r.body ? JSON.parse(r.body) : null;
    } catch {
      // not JSON: kept as text
    }
    return { status: r.statusCode, body };
  }
}
