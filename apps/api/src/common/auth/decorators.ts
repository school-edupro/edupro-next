import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'edupro:public';
export const AUTHENTICATED_ONLY = 'edupro:authenticated-only';
export const TENANT_OPTIONAL = 'edupro:tenant-optional';

/** No authentication at all (health checks, public forms). Use sparingly; every use is reviewed. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Any authenticated user, no permission required (for example GET /me). */
export const AuthenticatedOnly = () => SetMetadata(AUTHENTICATED_ONLY, true);

/** The route works with or without X-School-Id (for example GET /me lists memberships). */
export const TenantOptional = () => SetMetadata(TENANT_OPTIONAL, true);
