import { SetMetadata, applyDecorators } from '@nestjs/common';
import { PermissionRegistry } from './permission-registry';

export const REQUIRE_PERMISSION = 'edupro:require-permission';

export interface PermissionRequirement {
  code: string;
  /** Require a fresh MFA authentication (step-up) regardless of the catalogue flag. */
  mfa?: boolean;
  /** Human-readable description synchronised into the permissions table. */
  description?: string;
}

const CODE = /^[a-z_]+\.[a-z_]+\.[a-z_]+$/;

/**
 * Declares the permission a handler needs and registers it in the catalogue at import time (ADR-004).
 * Every non-public handler must carry exactly one of these; CI enforces it.
 */
export function RequirePermission(code: string, options: Omit<PermissionRequirement, 'code'> = {}) {
  if (!CODE.test(code)) {
    throw new Error(
      `Permission code "${code}" must match module.resource.action in lower snake case`,
    );
  }
  const requirement: PermissionRequirement = { code, ...options };
  PermissionRegistry.register(requirement);
  return applyDecorators(SetMetadata(REQUIRE_PERMISSION, requirement));
}
