import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import { DomainError } from '../../common/errors/domain-error';
import { ENV, type Env } from '../../config/env';
import { InternalCalls } from '../../common/http/internal-calls';
import {
  requireTenant,
  type ContextualRequest,
  type RequestContext,
} from '../../common/http/request-context';
import { AccessService } from '../access/access.service';
import type { ApprovalItem, Decision } from './approval-source';
import { APPROVAL_SOURCES } from './sources';

export interface Inbox {
  /** everything waiting, every kind (the kinds' counts added up) */
  total: number;
  /** each kind with something waiting: how many in all (a long list's items may stop at its route's page) */
  kinds: Array<{ kind: string; label: string; count: number }>;
  /** the items read (none when only the counts were asked for) */
  items: ApprovalItem[];
  /** kinds whose list could not be read just now (shown as such, not as nothing waiting) */
  unavailable: Array<{ kind: string; label: string }>;
}

/**
 * The approvals inbox (docs/design/89 §5.4): everything this person may decide, gathered on the server from the
 * routes the admin and staff web apps use, in one shape; a decision goes to that kind's own route.
 */
@Injectable()
export class ApprovalsService {
  private readonly logger = new Logger(ApprovalsService.name);

  constructor(
    private readonly access: AccessService,
    private readonly calls: InternalCalls,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async inbox(
    ctx: RequestContext,
    req: ContextualRequest,
    kind?: string,
    view: 'items' | 'counts' = 'items',
  ): Promise<Inbox> {
    const permissions = await this.access.effectivePermissions(requireTenant(ctx));
    const sources = APPROVAL_SOURCES.filter(
      (s) =>
        (!kind || s.kind === kind) &&
        (s.permissions.length === 0 || s.permissions.some((p) => permissions.has(p))) &&
        (s.needsAll ?? []).every((p) => permissions.has(p)),
    );
    const read = await Promise.all(
      sources.map(async (s) => {
        try {
          const r = await this.calls.call(req, s.list.method, s.list.url, s.list.body);
          if (r.status === 403 || r.status === 404) {
            // a kind asked only of those holding its rights should not be refused: its rights and its route disagree
            if (r.status === 403 && (s.permissions.length > 0 || s.needsAll?.length))
              this.logger.warn(`approvals inbox: ${s.kind} list refused (${s.list.url})`);
            return { s, items: [] as ApprovalItem[], count: 0 };
          }
          if (r.status >= 400) throw new Error(`${s.list.url} answered ${r.status}`);
          const items: ApprovalItem[] = s.items(r.body).map(({ adminHref, ...i }) => ({
            ...i,
            kind: s.kind,
            app: s.app,
            reasonOnReject: s.reasonOnReject ?? true,
            reasonOnApprove: s.reasonOnApprove ?? false,
            decideHere: s.decide !== undefined,
            approveAs: s.approveAs ?? 'approve',
            rejectAs: s.rejectAs === undefined ? 'reject' : s.rejectAs,
            url: s.app === 'admin' ? `${this.env.ADMIN_APP_URL}${i.href}` : null,
            adminHref: s.app === 'admin' ? i.href : (adminHref ?? null),
            staffUrl: s.app === 'teacher' ? `${this.env.TEACHER_APP_URL}${i.href}` : null,
          }));
          // the route's own count of everything waiting, never fewer than the items read
          const count = Math.max(s.total?.(r.body) ?? items.length, items.length);
          return { s, items, count };
        } catch (error) {
          this.logger.warn(`approvals inbox: ${s.kind} unavailable (${String(error)})`);
          return { s, items: null, count: 0 };
        }
      }),
    );
    const items =
      view === 'counts'
        ? []
        : read
            .flatMap((r) => r.items ?? [])
            // the oldest waiting first
            .sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''));
    const kinds = read
      .filter((r) => r.items !== null && r.count > 0)
      .map((r) => ({ kind: r.s.kind, label: r.s.label, count: r.count }));
    return {
      total: kinds.reduce((n, k) => n + k.count, 0),
      kinds,
      items,
      unavailable: read
        .filter((r) => r.items === null)
        .map((r) => ({ kind: r.s.kind, label: r.s.label })),
    };
  }

  async decide(
    ctx: RequestContext,
    req: ContextualRequest,
    kind: string,
    id: string,
    decision: Decision,
    reason: string | null,
  ) {
    const source = APPROVAL_SOURCES.find((s) => s.kind === kind);
    if (!source) throw new DomainError('not-found', 'No such kind of approval', { status: 404 });
    if (!source.decide)
      throw new DomainError('approvals.own_page', 'This is decided on its own page.', {
        status: 409,
      });
    if (decision === 'reject' && source.rejectAs === null)
      throw new DomainError('validation-failed', 'This can only be accepted here.', {
        status: 400,
      });
    const needsReason =
      decision === 'reject' ? (source.reasonOnReject ?? true) : (source.reasonOnApprove ?? false);
    if (needsReason && (reason ?? '').trim().length < 3)
      throw new DomainError('validation-failed', 'Write the reason (at least 3 letters).', {
        status: 400,
      });
    const call = source.decide(id, decision, reason?.trim() || null);
    const r = await this.calls.call(req, call.method, call.url, call.body);
    // the kind's own route wrote its audit row; this request writes none of its own
    ctx.auditWritten = true;
    if (r.status >= 400) throw new HttpException(r.body as object, r.status);
    return { kind, id, decision, result: r.body };
  }
}
