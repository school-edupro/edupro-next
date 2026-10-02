import { Injectable } from '@nestjs/common';
import type { PoolClient, TenantContext } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { TEMPLATE_VARIABLES } from './audience';
import type {
  Channel,
  CreateTemplateDto,
  ListTemplatesQueryDto,
  PreviewTemplateDto,
  UpdateTemplateDto,
} from './comms.dto';
import { emailLayout, sanitizeEmailHtml } from './email-html';
import { escapeHtml, extractVariables, htmlToText, renderLenient, smsUnits } from './render';

export interface TemplateRow {
  id: string;
  code: string;
  channel: Channel;
  name: string;
  subject: string | null;
  body: string;
  format: 'text' | 'html';
  category: 'service' | 'general';
  variables: string[];
  dltTemplateId: string | null;
  dltEntityId: string | null;
  senderId: string | null;
  waTemplateName: string | null;
  waLanguage: string | null;
  waParams: string[];
  waHeader: 'none' | 'text' | 'image' | 'document';
  providerTemplateId: string | null;
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
  format: 'text' | 'html';
  category: 'service' | 'general';
  variables: string[];
  dlt_template_id: string | null;
  dlt_entity_id: string | null;
  sender_id: string | null;
  wa_template_name: string | null;
  wa_language: string | null;
  wa_params: string[];
  wa_header: 'none' | 'text' | 'image' | 'document';
  provider_template_id: string | null;
  status: 'active' | 'inactive';
  updated_at: Date;
}

const SELECT = `SELECT id::text, code, channel, name, subject, body, format, category::text, variables, dlt_template_id, dlt_entity_id, sender_id,
         wa_template_name, wa_language, wa_params, wa_header, provider_template_id, status, updated_at FROM comms_templates`;

const toRow = (x: TemplateDbRow): TemplateRow => ({
  id: x.id,
  code: x.code,
  channel: x.channel,
  name: x.name,
  subject: x.subject,
  body: x.body,
  format: x.format,
  category: x.category,
  variables: x.variables,
  dltTemplateId: x.dlt_template_id,
  dltEntityId: x.dlt_entity_id,
  senderId: x.sender_id,
  waTemplateName: x.wa_template_name,
  waLanguage: x.wa_language,
  waParams: x.wa_params ?? [],
  waHeader: x.wa_header,
  providerTemplateId: x.provider_template_id,
  status: x.status,
  updatedAt: x.updated_at.toISOString(),
});

/** Example values for previews in the template master. */
export const SAMPLE_VARIABLES: Record<string, string> = {
  recipient_name: 'Suresh Sharma',
  school: 'Alpha Public School',
  date: '02 Oct 2026',
  student_name: 'Aarav Sharma',
  admission_no: 'A2401',
  class: 'VI-A',
  class_name: 'VI',
  section: 'A',
  roll_no: '7',
  father_name: 'Suresh Sharma',
  mother_name: 'Neha Sharma',
  guardian_name: 'Suresh Sharma',
  fee_due: '12,500',
  employee_name: 'Tanvi Rao',
  employee_code: 'T001',
  designation: 'TGT English',
  department: 'Academics',
  title: 'PTM on Saturday',
  body: 'The parent-teacher meeting is on Saturday at 9 am.',
  fee_due_heads: 'Tuition ₹10,000, Transport ₹2,500',
  last_paid_amount: '15,000',
  last_paid_date: '05 Sep 2026',
  attendance_percent: '92%',
  present_days: '23',
  absent_days: '2',
  last_exam: 'Half Yearly',
  last_exam_percent: '84.5%',
  last_exam_result: 'Pass',
  last_exam_grade: 'A2',
};

/**
 * The template master (v2): SMS with their DLT ids and a unit meter, WhatsApp with the name, language
 * and parameter order Meta approved, and email written in the HTML editor (sanitised; the school's frame
 * is added when sent). Variables come from the catalogue in audience.ts.
 */
@Injectable()
export class TemplatesService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  /** Built-in, computed and the school's own variables, for pickers. */
  async variables(ctx: RequestContext) {
    const custom = await this.customVariables(ctx);
    return [
      ...TEMPLATE_VARIABLES,
      ...custom.map((v) => ({
        key: v.key,
        label: `${v.label} (${v.value || 'empty'})`,
        for: 'school',
      })),
    ];
  }

  async customVariables(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ key: string; label: string; value: string; updated_at: Date }>(
        `SELECT key, label, value, updated_at FROM comms_variables ORDER BY key`,
      );
      return r.rows.map((x) => ({
        key: x.key,
        label: x.label,
        value: x.value,
        updatedAt: x.updated_at.toISOString(),
      }));
    });
  }

  /** A school variable: a fixed value every message can use, e.g. {{principal_name}}. */
  async saveCustomVariable(
    ctx: RequestContext,
    dto: { key: string; label: string; value: string },
  ) {
    if (TEMPLATE_VARIABLES.some((v) => v.key === dto.key) || dto.key in SAMPLE_VARIABLES)
      throw new DomainError(
        'conflict',
        `{{${dto.key}}} is a built-in variable; choose another name`,
        {
          status: 409,
        },
      );
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(
        `INSERT INTO comms_variables (school_id, key, label, value, updated_by) VALUES (app.current_school_id(), $1, $2, $3, app.current_user_id())
         ON CONFLICT (school_id, key) DO UPDATE SET label = EXCLUDED.label, value = EXCLUDED.value, updated_at = now(), updated_by = app.current_user_id()`,
        [dto.key, dto.label, dto.value],
      );
      await this.audit.stage(ctx, c, {
        action: 'comms.variable.save',
        entityType: 'comms_variables',
        entityId: dto.key,
        after: dto,
      });
      return { ok: true as const };
    });
  }

  async deleteCustomVariable(ctx: RequestContext, key: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(`DELETE FROM comms_variables WHERE key = $1`, [key]);
      await this.audit.stage(ctx, c, {
        action: 'comms.variable.delete',
        entityType: 'comms_variables',
        entityId: key,
      });
      return { ok: true as const };
    });
  }

  list(tenant: TenantContext, q: ListTemplatesQueryDto): Promise<TemplateRow[]> {
    return this.db.tenant(tenant, async (c) => {
      const r = await c.query<TemplateDbRow>(
        SELECT +
          ' WHERE deleted_at IS NULL AND ($1::comms_channel IS NULL OR channel = $1::comms_channel) AND ($2::row_status IS NULL OR status = $2::row_status) ORDER BY channel, name',
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

  /** The template with sample values: SMS units, the framed HTML email, unknown variables. */
  async preview(ctx: RequestContext, dto: PreviewTemplateDto) {
    const tenant = requireTenant(ctx);
    const school = await this.db.tenant(tenant, async (c) => {
      const r = await c.query<{ name: string }>(
        `SELECT name FROM schools WHERE id = app.current_school_id()`,
      );
      return r.rows[0]?.name ?? 'School';
    });
    const custom = Object.fromEntries(
      (await this.customVariables(ctx)).map((v) => [v.key, v.value]),
    );
    const vars = { ...custom, ...SAMPLE_VARIABLES, school };
    const html = dto.channel === 'email' && dto.format === 'html';
    const body = html
      ? renderLenient(sanitizeEmailHtml(dto.body), vars, escapeHtml)
      : renderLenient(dto.body, vars);
    return {
      subject: dto.subject ? renderLenient(dto.subject, vars) : null,
      body,
      html: html ? emailLayout(escapeHtml(school), body) : null,
      text: html ? htmlToText(body) : body,
      sms: dto.channel === 'sms' ? smsUnits(body) : null,
      unknownVariables: extractVariables(`${dto.subject ?? ''} ${dto.body}`).filter(
        (v) => !(v in vars),
      ),
    };
  }

  private clean(body: string | undefined, format: string | undefined, channel: Channel) {
    if (body === undefined) return undefined;
    return channel === 'email' && format === 'html' ? sanitizeEmailHtml(body) : body;
  }

  private check(channel: Channel, format: string | undefined, body: string | undefined) {
    if (channel !== 'email' && format === 'html')
      throw new DomainError('validation-failed', 'Only email templates can be HTML', {
        status: 400,
      });
    if (channel !== 'email' && body !== undefined && body.length > 4000)
      throw new DomainError(
        'validation-failed',
        'SMS and WhatsApp texts are at most 4000 characters',
        { status: 400 },
      );
  }

  async create(ctx: RequestContext, dto: CreateTemplateDto): Promise<TemplateRow> {
    const tenant = requireTenant(ctx);
    this.check(dto.channel, dto.format, dto.body);
    const body = this.clean(dto.body, dto.format, dto.channel)!;
    const variables = dto.variables ?? extractVariables(`${dto.subject ?? ''} ${body}`);
    return this.db.tenant(tenant, async (c) => {
      let id: string;
      try {
        const r = await c.query<{ id: string }>(
          `INSERT INTO comms_templates (school_id, code, channel, name, subject, body, format, category, variables, dlt_template_id, dlt_entity_id, sender_id,
                                        wa_template_name, wa_language, wa_params, wa_header, provider_template_id, created_by, updated_by)
           VALUES (app.current_school_id(), $1, $2::comms_channel, $3, $4, $5, $6, $7::message_category, $8::jsonb, $9, $10, $11, $12, $13, $14::jsonb, $15, $16, app.current_user_id(), app.current_user_id())
           RETURNING id::text`,
          [
            dto.code,
            dto.channel,
            dto.name,
            dto.subject ?? null,
            body,
            dto.channel === 'email' ? (dto.format ?? 'text') : 'text',
            dto.category ?? 'general',
            JSON.stringify(variables),
            dto.dltTemplateId ?? null,
            dto.dltEntityId ?? null,
            dto.senderId ?? null,
            dto.waTemplateName || null,
            dto.waLanguage ?? (dto.channel === 'whatsapp' ? 'en' : null),
            JSON.stringify(dto.waParams ?? []),
            dto.waHeader ?? 'none',
            dto.providerTemplateId ?? null,
          ],
        );
        id = r.rows[0]!.id;
      } catch (error) {
        if ((error as { code?: string }).code === '23505')
          throw new DomainError(
            'conflict',
            `A ${dto.channel} template with code "${dto.code}" exists`,
            { status: 409 },
          );
        throw error;
      }
      const created = await this.get(tenant, id, c);
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
      const format = dto.format ?? before.format;
      this.check(before.channel, dto.format, dto.body);
      const body = this.clean(dto.body, format, before.channel);
      const sets: string[] = ['updated_by = app.current_user_id()', 'updated_at = now()'];
      const params: unknown[] = [];
      const set = (col: string, v: unknown, cast = '') => {
        params.push(v);
        sets.push(`${col} = $${String(params.length)}${cast}`);
      };
      if (dto.name !== undefined) set('name', dto.name);
      if (dto.subject !== undefined) set('subject', dto.subject);
      if (body !== undefined) set('body', body);
      if (dto.format !== undefined && before.channel === 'email') set('format', dto.format);
      if (dto.category !== undefined) set('category', dto.category, '::message_category');
      if (dto.dltTemplateId !== undefined) set('dlt_template_id', dto.dltTemplateId);
      if (dto.dltEntityId !== undefined) set('dlt_entity_id', dto.dltEntityId);
      if (dto.senderId !== undefined) set('sender_id', dto.senderId);
      if (dto.waTemplateName !== undefined) set('wa_template_name', dto.waTemplateName || null);
      if (dto.waLanguage !== undefined) set('wa_language', dto.waLanguage);
      if (dto.waParams !== undefined) set('wa_params', JSON.stringify(dto.waParams), '::jsonb');
      if (dto.waHeader !== undefined) set('wa_header', dto.waHeader);
      if (dto.providerTemplateId !== undefined) set('provider_template_id', dto.providerTemplateId);
      if (dto.status !== undefined) set('status', dto.status);
      const variables =
        dto.variables ??
        (body !== undefined || dto.subject !== undefined
          ? extractVariables(`${dto.subject ?? before.subject ?? ''} ${body ?? before.body}`)
          : undefined);
      if (variables !== undefined) set('variables', JSON.stringify(variables), '::jsonb');
      if (before.channel === 'sms' && dto.dltTemplateId === '')
        throw new DomainError(
          'validation-failed',
          'SMS templates need the DLT content template id',
          { status: 400 },
        );
      params.push(id);
      await c.query(
        // eslint-disable-next-line no-restricted-syntax -- column names are fixed; values are bound parameters
        `UPDATE comms_templates SET ${sets.join(', ')} WHERE id = $${String(params.length)}`,
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

  async remove(ctx: RequestContext, id: string): Promise<{ ok: true }> {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const before = await this.get(tenant, id, c);
      await c.query(
        // the code is freed (renamed) so a new template can reuse it; the unique index covers deleted rows
        `UPDATE comms_templates SET deleted_at = now(), status = 'inactive', code = left(code, 40) || '_del' || id::text, updated_by = app.current_user_id() WHERE id = $1`,
        [id],
      );
      await this.audit.stage(ctx, c, {
        action: 'comms.template.delete',
        entityType: 'comms_templates',
        entityId: id,
        before,
      });
      return { ok: true as const };
    });
  }
}
