import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { TenantContext } from '@edupro/db';

/** Identity established by JwtAuthGuard. */
export interface AuthenticatedUser {
  /** users.id as a numeric string */
  id: string;
  /** One Auth subject */
  sub: string;
  displayName: string;
  /** Schools the user is an active member of */
  memberships: Array<{
    schoolId: string;
    schoolCode: string;
    schoolName: string;
    personType: string;
  }>;
  /** True when the token proves an MFA authentication */
  mfa: boolean;
  /** Unix seconds of the authentication event, when the IdP provides it */
  authTime?: number;
  /** Development bypass token was used */
  dev: boolean;
  /** The mobile app's session the token belongs to (docs/design/89): signed out phones are refused. */
  mobileSessionId?: string;
  /**
   * A family website session opened from the staff or admin website (My children, 0424/0425): the website it came
   * from. Only such a session may ask for the way back (a code for that website).
   */
  hopFrom?: 'teacher' | 'admin';
  /** A code sign-in token: the website it was made for (`parent` = a family sign-in of its own). */
  codeApp?: string;
  /**
   * The profile the request acts as (header `X-Acting-As`, docs/design/89): a teacher who is also a parent in
   * the school reads as the parent with `family`. Honoured only when the person has that membership.
   */
  actingAs?: 'family';
  /** Present when the request runs under an impersonation session (S5-02). */
  impersonation?: {
    sessionId: string;
    byUserId: string;
    byDisplayName: string;
    expiresAt: string;
    /** 'full': the admin app's impersonation; 'view' / 'act': a portal opened as someone (0183) */
    mode: 'full' | 'view' | 'act';
    app: 'admin' | 'parent' | 'teacher';
  };
}

/** Everything a handler needs about the current request. Built by the guards, read by services. */
export interface RequestContext {
  requestId: string;
  user: AuthenticatedUser;
  /** Present when a school was selected (TenantGuard). Absent on tenant-optional routes such as /me. */
  tenant?: TenantContext;
  /** Effective permission codes for (user, school). Set by PermissionGuard. */
  permissions?: ReadonlySet<string>;
  /** Snapshot the service wants recorded by AuditInterceptor (after commit). */
  audit?: AuditSnapshot;
  /** Set by AuditService.stage() when the service already wrote the audit row inside its transaction. */
  auditWritten?: boolean;
  /** Permission code the handler declared (PermissionGuard), recorded on audit rows. */
  requiredPermission?: string;
  ip?: string;
  userAgent?: string;
}

export interface AuditSnapshot {
  action: string;
  entityType: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
}

export type ContextualRequest = FastifyRequest & { ctx?: RequestContext };

export function getRequestContext(req: ContextualRequest): RequestContext {
  if (!req.ctx) throw new Error('RequestContext is not initialised; is JwtAuthGuard registered?');
  return req.ctx;
}

/** Injects the RequestContext into a handler parameter. */
export const ReqCtx = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestContext => {
    return getRequestContext(ctx.switchToHttp().getRequest<ContextualRequest>());
  },
);

/** Returns the tenant context or throws; use in services that must never run without a school. */
export function requireTenant(ctx: RequestContext): TenantContext {
  if (!ctx.tenant) throw new Error('Handler requires a tenant context but none was resolved');
  return ctx.tenant;
}
