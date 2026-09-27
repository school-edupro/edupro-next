import { Injectable } from '@nestjs/common';
import type { PoolClient, TenantContext } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import type {
  Channel,
  CreateTemplateDto,
  ListTemplatesQueryDto,
  UpdateTemplateDto,
} from './comms.dto';
import { extractVariables } from './render';

export interface TemplateRow {
  id: string;
  code: string;
  channel: Channel;
  name: string;
  subject: string | null;
  body: string;
  variables: string[];
  dltTemplateId: string | null;
  dltEntityId: string | null;
  senderId: string | null;
  status: 'active' | 'inactive';
  updatedAt: string;
}

interface TemplateDbRow {
  id: string;
  code: string;
  channel: Channel;
  name: string;
  subject: string | null;
  body: string;
  variables: string[];
  dlt_template_id: string | null;
  dlt_entity_id: string | null;
  sender_id: string | null;
  status: 'active' | 'inactive';
  updated_at: Date;
}

const SELECT =
  'SELECT id::text, code, channel, name, subject, body, variables, dlt_template_id, dlt_entity_id, sender_id, status, updated_at FROM comms_templates';

const toRow = (x: TemplateDbRow): TemplateRow => ({
  id: x.id,
  code: x.code,
  channel: x.channel,
  name: x.name,
  subject: x.subject,
  body: x.body,
  variables: x.variables,
  dltTemplateId: x.dlt_template_id,
  dltEntityId: x.dlt_entity_id,
  senderId: x.sender_id,
  status: x.status,
  updatedAt: x.updated_at.toISOString(),
});

@Injectable()
export class TemplatesService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  list(tenant: TenantContext, q: ListTemplatesQueryDto): Promise<TemplateRow[]> {
    return this.db.tenant(tenant, async (c) => {
      const r = await c.query<TemplateDbRow>(
        SELECT +
          ' WHERE deleted_at IS NULL AND ($1::comms_channel IS NULL OR channel = $1::comms_channel) AND ($2::row_status IS NULL OR status = $2::row_status) ORDER BY channel, code',
        [q.channel ?? null, q.status ?? null],
      );
      return r.rows.map(toRow);
    });
  }

  async get(tenant: TenantContext, id: string, client?: PoolClient): Promise<TemplateRow> {
    const run = async (c: PoolClient) => {
      const r = await c.query<TemplateDbRow>(SELECT + ' WHERE id = $1 AND deleted_at IS NULL', [
        id,
      ]);
      if (!r.rows[0]) throw new DomainError('not-found', 'Template not found');
      return toRow(r.rows[0]);
    };
    return client ? run(client) : this.db.tenant(tenant, run);
  }

  async create(ctx: RequestContext, dto: CreateTemplateDto): Promise<TemplateRow> {
    const tenant = requireTenant(ctx);
    const variables = dto.variables ?? extractVariables(`${dto.subject ?? ''} ${dto.body}`);
    return this.db.tenant(tenant, async (c) => {
      const r = await c.query<{ id: string }>(
        `INSERT INTO comms_templates (school_id, code, channel, name, subject, body, variables, dlt_template_id, dlt_entity_id, sender_id, created_by, updated_by)
         VALUES (app.current_school_id(), $1, $2::comms_channel, $3, $4, $5, $6::jsonb, $7, $8, $9, app.current_user_id(), app.current_user_id())
         RETURNING id::text`,
        [
          dto.code,
          dto.channel,
          dto.name,
          dto.subject ?? null,
          dto.body,
          JSON.stringify(variables),
          dto.dltTemplateId ?? null,
          dto.dltEntityId ?? null,
          dto.senderId ?? null,
        ],
      );
      const created = await this.get(tenant, r.rows[0]!.id, c);
      await this.audit.stage(ctx, c, {
        action: 'comms.template.create',
        entityType: 'comms_templates',
        entityId: created.id,
        after: created,
      });
      return created;
    });
  }

  async update(ctx: RequestContext, id: string, dto: UpdateTemplateDto): Promise<TemplateRow> {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const before = await this.get(tenant, id, c);
      const sets: string[] = ['updated_by = app.current_user_id()'];
      const params: unknown[] = [];
      const set = (col: string, v: unknown) => {
        params.push(v);
        sets.push(col + ' = $' + String(params.length));
      };
      if (dto.name !== undefined) set('name', dto.name);
      if (dto.subject !== undefined) set('subject', dto.subject);
      if (dto.body !== undefined) set('body', dto.body);
      if (dto.dltTemplateId !== undefined) set('dlt_template_id', dto.dltTemplateId);
      if (dto.dltEntityId !== undefined) set('dlt_entity_id', dto.dltEntityId);
      if (dto.senderId !== undefined) set('sender_id', dto.senderId);
      if (dto.status !== undefined) set('status', dto.status);
      const variables =
        dto.variables ??
        (dto.body !== undefined || dto.subject !== undefined
          ? extractVariables(`${dto.subject ?? before.subject ?? ''} ${dto.body ?? before.body}`)
          : undefined);
      if (variables !== undefined) {
        params.push(JSON.stringify(variables));
        sets.push('variables = $' + String(params.length) + '::jsonb');
      }
      if (before.channel === 'sms' && dto.dltTemplateId === '') {
        throw new DomainError(
          'validation-failed',
          'SMS templates need the DLT content template id',
          {
            status: 400,
          },
        );
      }
      params.push(id);
      await c.query(
        'UPDATE comms_templates SET ' + sets.join(', ') + ' WHERE id = $' + String(params.length),
        params,
      );
      const after = await this.get(tenant, id, c);
      await this.audit.stage(ctx, c, {
        action: 'comms.template.edit',
        entityType: 'comms_templates',
        entityId: id,
        before,
        after,
      });
      return after;
    });
  }
}
