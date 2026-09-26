import { Injectable, Logger, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import { REQUIRE_PERMISSION, type PermissionRequirement } from '../access/require-permission.decorator';
import type { ContextualRequest } from '../http/request-context';
import { AuditService } from './audit.service';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Writes one audit row after a mutating handler succeeds. Services describe what changed through
 * ctx.audit; when they do not, a generic entry with route and permission is still written so no
 * mutation goes unrecorded. Failures to audit are logged loudly but never fail the user's request.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<ContextualRequest>();
    const method = req.method.toUpperCase();
    const ctx = req.ctx;
    if (!ctx || !ctx.tenant || !MUTATING.has(method)) return next.handle();

    const requirement = this.reflector.getAllAndOverride<PermissionRequirement | undefined>(REQUIRE_PERMISSION, [
      context.getHandler(),
      context.getClass(),
    ]);

    return next.handle().pipe(
      tap({
        next: () => {
          const snapshot = ctx.audit ?? {
            action: `${method.toLowerCase()} ${req.routeOptions?.url ?? req.url}`,
            entityType: context.getClass().name.replace(/Controller$/, '').toLowerCase(),
          };
          void this.audit.record(ctx, snapshot, requirement?.code).catch((error: unknown) => {
            this.logger.error(`audit write failed for request ${ctx.requestId}: ${String(error)}`);
          });
        },
      }),
    );
  }
}
