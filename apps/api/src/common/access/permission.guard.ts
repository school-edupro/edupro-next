import {
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ENV, type Env } from '../../config/env';
import { AccessService } from '../../modules/access/access.service';
import { AUTHENTICATED_ONLY, IS_PUBLIC } from '../auth/decorators';
import type { ContextualRequest } from '../http/request-context';
import { REQUIRE_PERMISSION, type PermissionRequirement } from './require-permission.decorator';

/**
 * Third guard. Deny by default: a handler without @RequirePermission(), @AuthenticatedOnly() or @Public()
 * is a configuration error and is refused with 500 so it is noticed immediately (CI also catches it).
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: AccessService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = context.switchToHttp().getRequest<ContextualRequest>();
    const ctx = req.ctx;
    if (!ctx) throw new ForbiddenException({ type: 'unauthenticated' });

    if (this.reflector.getAllAndOverride<boolean>(AUTHENTICATED_ONLY, targets)) return true;

    const requirement = this.reflector.getAllAndOverride<PermissionRequirement | undefined>(
      REQUIRE_PERMISSION,
      targets,
    );
    if (!requirement) {
      throw new InternalServerErrorException({
        type: 'handler-misconfigured',
        detail: `${context.getClass().name}.${context.getHandler().name} declares no permission`,
      });
    }
    if (!ctx.tenant) {
      throw new ForbiddenException({
        type: 'tenant-required',
        detail: 'A school must be selected for this action',
      });
    }

    const permissions = await this.access.effectivePermissions(ctx.tenant);
    ctx.permissions = permissions;
    ctx.requiredPermission = requirement.code;

    if (!permissions.has(requirement.code)) {
      throw new ForbiddenException({
        type: 'permission-denied',
        detail: `Missing permission ${requirement.code}`,
        permission: requirement.code,
      });
    }

    const needsMfa = requirement.mfa === true || (await this.access.requiresMfa(requirement.code));
    if (needsMfa && !this.isFreshMfa(ctx.user.mfa, ctx.user.authTime)) {
      throw new ForbiddenException({
        type: 'mfa-required',
        detail: 'This action requires a recent multi-factor authentication',
        permission: requirement.code,
      });
    }

    // Segregation of duties is enforced at grant time; re-check here in case a conflicting grant slipped in.
    const conflict = await this.access.sodConflict(ctx.tenant, requirement.code, permissions);
    if (conflict) {
      throw new ForbiddenException({
        type: 'sod-conflict',
        detail: `Permission ${requirement.code} conflicts with ${conflict} held by the same user`,
      });
    }

    return true;
  }

  private isFreshMfa(mfa: boolean, authTime?: number): boolean {
    if (!mfa) return false;
    if (authTime === undefined) return true; // IdP did not provide auth_time; MFA claim alone is accepted
    const ageSeconds = Math.floor(Date.now() / 1000) - authTime;
    return ageSeconds <= this.env.MFA_FRESHNESS_MINUTES * 60;
  }
}
