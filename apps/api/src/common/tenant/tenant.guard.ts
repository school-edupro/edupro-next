import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC, TENANT_OPTIONAL } from '../auth/decorators';
import { DbService } from '../db/db.service';
import type { ContextualRequest } from '../http/request-context';

const ID = /^[0-9]{1,18}$/;

/**
 * Second guard. Resolves the school (X-School-Id) against the caller's memberships and the working academic
 * year (X-Academic-Year-Id, defaulting to the active year), and attaches a TenantContext to request.ctx.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: DbService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = context.switchToHttp().getRequest<ContextualRequest>();
    const ctx = req.ctx;
    if (!ctx) throw new ForbiddenException({ type: 'unauthenticated' });

    const optional = this.reflector.getAllAndOverride<boolean>(TENANT_OPTIONAL, targets) === true;
    const memberships = ctx.user.memberships;
    const allowedSchoolIds = memberships.map((m) => m.schoolId);

    let schoolId = (req.headers['x-school-id'] as string | undefined)?.trim();
    if (!schoolId && memberships.length === 1) schoolId = memberships[0]!.schoolId;

    if (!schoolId) {
      if (optional) return true;
      throw new BadRequestException({
        type: 'tenant-required',
        detail: 'X-School-Id header is required when the user belongs to several schools',
      });
    }
    if (!ID.test(schoolId) || !allowedSchoolIds.includes(schoolId)) {
      throw new ForbiddenException({
        type: 'tenant-forbidden',
        detail: 'You are not a member of this school',
      });
    }

    const requestedYear = (req.headers['x-academic-year-id'] as string | undefined)?.trim();
    if (requestedYear && !ID.test(requestedYear)) {
      throw new BadRequestException({
        type: 'validation-failed',
        detail: 'X-Academic-Year-Id must be numeric',
      });
    }

    const baseCtx = {
      schoolId,
      userId: ctx.user.id,
      allowedSchoolIds,
      requestId: ctx.requestId,
    };

    // Resolve the working year inside the tenant context so RLS proves the year belongs to this school.
    const academicYearId = await this.db.raw.withTenant(baseCtx, async (c) => {
      if (requestedYear) {
        const r = await c.query<{ id: string }>(
          `SELECT id::text FROM academic_years WHERE id = $1 AND status <> 'planned'`,
          [requestedYear],
        );
        if (r.rowCount === 0) {
          throw new ForbiddenException({
            type: 'year-forbidden',
            detail: 'The requested academic year does not belong to this school or is not open',
          });
        }
        return requestedYear;
      }
      const r = await c.query<{ id: string }>(
        `SELECT id::text FROM academic_years WHERE status = 'active' LIMIT 1`,
      );
      return r.rows[0]?.id ?? null;
    });

    ctx.tenant = { ...baseCtx, academicYearId };
    return true;
  }
}
