import { ForbiddenException, Injectable } from '@nestjs/common';
import type { TenantContext } from '@edupro/db';
import { AccessService, type ScopeType } from '../../modules/access/access.service';

/**
 * Data-level restrictions attached to role assignments (ADR-004 point 4).
 * `filter()` returns null when the user is unrestricted for the scope type, otherwise the allowed ids.
 * `assert()` throws when an id is outside the user's scope.
 */
@Injectable()
export class ScopePolicy {
  constructor(private readonly access: AccessService) {}

  async filter(tenant: TenantContext, permission: string, scopeType: ScopeType): Promise<string[] | null> {
    return this.access.scopesFor(tenant, permission, scopeType);
  }

  async assert(tenant: TenantContext, permission: string, scopeType: ScopeType, id: string): Promise<void> {
    const allowed = await this.filter(tenant, permission, scopeType);
    if (allowed === null) return;
    if (!allowed.includes(id)) {
      throw new ForbiddenException({
        type: 'scope-denied',
        detail: `This ${scopeType.replace('_', ' ')} is outside your assigned scope`,
      });
    }
  }
}
