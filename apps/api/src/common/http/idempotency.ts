import { createHash } from 'node:crypto';
import {
  Injectable,
  SetMetadata,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import type { FastifyReply } from 'fastify';
import { from, mergeMap, of, tap, type Observable } from 'rxjs';
import { DbService } from '../db/db.service';
import { DomainError } from '../errors/domain-error';
import type { ContextualRequest } from './request-context';

export const IDEMPOTENT = 'edupro:idempotent';

/**
 * The route may be sent again with the same `Idempotency-Key` header (the mobile app's outbox, docs/design/89 §5.6):
 * a repeat gets the first answer instead of being done twice. Without the header the route works as before.
 */
export const Idempotent = () => SetMetadata(IDEMPOTENT, true);

const KEY = /^[A-Za-z0-9_-]{8,100}$/;

/**
 * For routes marked `@Idempotent()` and a request with `Idempotency-Key`: the first request with a key runs and its
 * answer is kept (per person, two days, migration 0402); the same request again is answered from that; the key with
 * another request is refused; while the first still runs, a repeat is told to try again. A failed request frees its
 * key. Runs before the audit interceptor, so a replay writes no second audit row.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: DbService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<ContextualRequest>();
    const key = req.headers['idempotency-key'];
    if (
      typeof key !== 'string' ||
      !this.reflector.getAllAndOverride<boolean>(IDEMPOTENT, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return next.handle();
    const ctx = req.ctx;
    if (!ctx?.user) return next.handle();
    if (!KEY.test(key))
      throw new DomainError(
        'idempotency.bad_key',
        'The Idempotency-Key header must be 8 to 100 letters, digits, - or _.',
        { status: 400 },
      );
    const reply = context.switchToHttp().getResponse<FastifyReply>();
    const route = `${req.method} ${req.routeOptions?.url ?? req.url}`;
    const hash = createHash('sha256')
      .update(
        JSON.stringify({
          params: req.params ?? {},
          query: req.query ?? {},
          body: req.body ?? null,
        }),
      )
      .digest('hex');
    const status =
      this.reflector.get<number | undefined>(HTTP_CODE_METADATA, context.getHandler()) ??
      (req.method === 'POST' ? 201 : 200);
    const userId = ctx.user.id;
    return from(
      this.db.global(async (c) => {
        const r = await c.query<{ outcome: string; status: number | null; body: unknown }>(
          `SELECT outcome, status, body FROM app.idempotency_begin($1, $2, $3, $4, $5)`,
          [userId, key, route, ctx.tenant?.schoolId ?? null, hash],
        );
        return r.rows[0]!;
      }),
    ).pipe(
      mergeMap((begun) => {
        if (begun.outcome === 'replay') {
          void reply.status(begun.status ?? status).header('Idempotent-Replayed', 'true');
          return of(begun.body);
        }
        if (begun.outcome === 'running')
          throw new DomainError(
            'idempotency.in_progress',
            'The same request is still being handled. Try again in a moment.',
            { status: 409 },
          );
        if (begun.outcome === 'mismatch')
          throw new DomainError(
            'idempotency.key_reused',
            'This Idempotency-Key was used for another request.',
            { status: 422 },
          );
        return next.handle().pipe(
          tap({
            next: (body) => {
              void this.db
                .global((c) =>
                  c.query(`SELECT app.idempotency_done($1, $2, $3, $4)`, [
                    userId,
                    key,
                    status,
                    JSON.stringify(body ?? null),
                  ]),
                )
                .catch(() => undefined);
            },
            error: () => {
              void this.db
                .global((c) => c.query(`SELECT app.idempotency_abandon($1, $2)`, [userId, key]))
                .catch(() => undefined);
            },
          }),
        );
      }),
    );
  }
}
