import { Injectable } from '@nestjs/common';
import {
  LAYOUT_TYPES,
  admissionWaitingFor,
  answerText,
  fieldState,
  liveAnswers,
  matchCategory,
  type AdmissionAnswers,
  type AdmissionField,
  type AdmissionFormDef,
  type PoolClient,
} from '@edupro/db';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import ExcelJS from 'exceljs';
import { AdmissionCoreService } from './admission-core.service';
import { tablePdf } from './admission-pdf';
import type { ApprovalCorrectDto, ApprovalDecideDto, ApprovalsQueryDto } from './approvals.dto';
import { AdmissionDeskService } from './desk.service';
import { AdmissionFormsService } from './forms.service';
import { ADMISSION_SETUP_MANAGE, AdmissionProcessService } from './process.service';
import type { SendBackDto } from './process.dto';
import { AdmissionSetupService } from './setup.service';

/** How long a decided registration stays in "Decided by me" (read-only). */
const DECIDED_DAYS = 30;
const NOT_ASKED = new Set(['file', 'photo', 'agree', 'address_same', 'signature']);
/** Answers an approver may change on the review (docs/design/51); the rest stay the family's. */
const EDITABLE = new Set([
  'text',
  'textarea',
  'number',
  'email',
  'mobile',
  'date',
  'select',
  'radio',
  'yesno',
  'checkbox',
]);
const SECRET = (f: AdmissionField) =>
  ['aadhaar', 'apaar', 'pen'].includes(f.preset ?? '') ||
  ['aadhaar_no', 'apaar_id', 'pen_no'].includes(f.maps ?? '');
const DECISION: Record<string, string> = {
  approved: 'Approved',
  rejected: 'Not selected',
  hold: 'On hold',
  offered: 'Offered',
  waitlisted: 'Waiting list',
};

export interface LevelRemark {
  stage: string;
  level: number;
  levels: number;
  levelName: string;
  decision: string;
  remarks: string | null;
  by: string | null;
  at: string;
}

/**
 * Admission approvers (docs/design/50): the people a process level names see the registrations waiting
 * at their level and decide there — no Admissions permission needed — and, read-only for a while,
 * those they decided. Everything is checked per registration; one they may not see is "not found".
 */
@Injectable()
export class AdmissionApprovalsService {
  constructor(
    private readonly db: DbService,
    private readonly core: AdmissionCoreService,
    private readonly process: AdmissionProcessService,
    private readonly desk: AdmissionDeskService,
    private readonly setup: AdmissionSetupService,
  ) {}

  /** Waiting at a level this user is named in (may decide), or decided by them lately (may look). */
  private async access(c: PoolClient, ctx: RequestContext, id: string) {
    if (!/^\d{1,18}$/.test(id))
      throw new DomainError('not-found', 'Registration not found', { status: 404 });
    const waiting = await admissionWaitingFor(c, ctx.user.id);
    if (waiting.has(id)) return { mayDecide: true };
    if (ctx.permissions?.has(ADMISSION_SETUP_MANAGE)) {
      const w = await c.query(`SELECT 1 FROM admission_waiting WHERE id = $1`, [id]);
      if (w.rows.length) return { mayDecide: true };
    }
    const mine = await c.query(
      `SELECT 1 FROM admission_stage_results WHERE application_id = $1 AND decided_by = $2 AND undone_at IS NULL
          AND decided_at > now() - make_interval(days => $3)`,
      [id, ctx.user.id, DECIDED_DAYS],
    );
    if (mine.rows.length) return { mayDecide: false };
    throw new DomainError('not-found', 'Registration not found', { status: 404 });
  }

  /** Every level's decision with its remark, in order (the latest decision of each level). */
  private async remarksOf(c: PoolClient, ids: string[]): Promise<Map<string, LevelRemark[]>> {
    const out = new Map<string, LevelRemark[]>();
    if (!ids.length) return out;
    const r = await c.query<{
      application_id: string;
      stage: string;
      level: number;
      levels: number;
      level_name: string | null;
      decision: string;
      remarks: string | null;
      by: string | null;
      at: Date;
    }>(
      `SELECT DISTINCT ON (x.application_id, x.stage_id, x.level)
              x.application_id::text, st.name AS stage, x.level,
              COALESCE(jsonb_array_length(step -> 'levels'), 1) AS levels,
              step -> 'levels' -> (x.level - 1) ->> 'name' AS level_name,
              x.decision, x.remarks, x.decided_by_name AS by, x.decided_at AS at
         FROM admission_stage_results x
         JOIN applications a ON a.id = x.application_id
         JOIN admission_stages st ON st.id = x.stage_id
         LEFT JOIN LATERAL (SELECT s AS step FROM jsonb_array_elements(a.process_steps) s
                             WHERE s ->> 'stageId' = x.stage_id::text LIMIT 1) ps ON true
        WHERE x.application_id = ANY($1::bigint[]) AND x.undone_at IS NULL
        ORDER BY x.application_id, x.stage_id, x.level, x.decided_at DESC`,
      [ids],
    );
    for (const x of r.rows) {
      const list = out.get(x.application_id) ?? [];
      list.push({
        stage: x.stage,
        level: x.level,
        levels: x.levels,
        levelName: x.level_name ?? `Level ${String(x.level)}`,
        decision: x.decision,
        remarks: x.remarks,
        by: x.by,
        at: x.at.toISOString(),
      });
      out.set(x.application_id, list);
    }
    for (const l of out.values()) l.sort((a, b) => a.at.localeCompare(b.at));
    return out;
  }

  /**
   * Waiting for me (to decide) or Decided by me (the last days), each with the levels' remarks,
   * filtered (docs/design/51); the filters' choices come from the tab's rows before filtering.
   */
  async list(ctx: RequestContext, q: ApprovalsQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const waiting = [...(await admissionWaitingFor(c, ctx.user.id))];
      const decidedRows = (
        await c.query<{ id: string; at: Date }>(
          `SELECT x.application_id::text AS id, max(x.decided_at) AS at FROM admission_stage_results x
            WHERE x.decided_by = $1 AND x.undone_at IS NULL AND x.decided_at > now() - make_interval(days => $2)
            GROUP BY x.application_id`,
          [ctx.user.id, DECIDED_DAYS],
        )
      ).rows.filter((x) => !waiting.includes(x.id));
      const decidedAt = new Map(decidedRows.map((x) => [x.id, x.at]));
      const ids = q.tab === 'decided' ? decidedRows.map((x) => x.id) : waiting;
      const r = ids.length
        ? await c.query<{
            id: string;
            number: string | null;
            candidate: string | null;
            mobile: string | null;
            class_id: string;
            class_name: string;
            cycle_id: string;
            session: string;
            category_id: string | null;
            category: string | null;
            status: string;
            form_points: string | null;
            merit: string | null;
            stage: string | null;
            level_no: number | null;
            levels: number | null;
            level_name: string | null;
            level_since: Date | null;
            due_at: Date | null;
          }>(
            `SELECT a.id::text, a.application_no AS number, a.candidate_name AS candidate, a.contact_mobile AS mobile,
                    a.class_id::text, cl.name AS class_name, a.cycle_id::text, y.name AS session,
                    a.category_id::text, k.name AS category, a.status::text, a.form_points::text, a.merit::text,
                    st.name AS stage, w.level_no, w.levels, w.level ->> 'name' AS level_name, a.level_since, w.due_at
               FROM applications a JOIN classes cl ON cl.id = a.class_id JOIN admission_cycles y ON y.id = a.cycle_id
               LEFT JOIN admission_fee_categories k ON k.id = a.category_id
               LEFT JOIN admission_waiting w ON w.id = a.id
               LEFT JOIN admission_stages st ON st.id = (w.step ->> 'stageId')::bigint
              WHERE a.id = ANY($1::bigint[])
              ORDER BY (w.due_at < now()) DESC NULLS LAST, a.level_since NULLS LAST, a.id`,
            [ids],
          )
        : { rows: [] };
      const now = Date.now();
      const levelOf = (x: (typeof r.rows)[number]) =>
        x.level_no && x.levels
          ? `${x.level_name ?? `Level ${String(x.level_no)}`}${x.levels > 1 ? ` (${String(x.level_no)} of ${String(x.levels)})` : ''}`
          : null;
      // the choices of each filter, from the tab's rows
      const uniq = <T extends { id: string; name: string }>(l: T[]) =>
        [...new Map(l.filter((x) => x.id).map((x) => [x.id, x])).values()].sort((a, b) =>
          a.name.localeCompare(b.name),
        );
      const options = {
        sessions: uniq(r.rows.map((x) => ({ id: x.cycle_id, name: x.session }))),
        classes: uniq(r.rows.map((x) => ({ id: x.class_id, name: x.class_name }))),
        categories: uniq(
          r.rows
            .filter((x) => x.category_id)
            .map((x) => ({ id: x.category_id!, name: x.category! })),
        ),
        stages: [
          ...new Set(r.rows.map((x) => x.stage).filter((x): x is string => Boolean(x))),
        ].sort(),
        levels: [...new Set(r.rows.map(levelOf).filter((x): x is string => Boolean(x)))].sort(),
        statuses: [...new Set(r.rows.map((x) => x.status))].sort(),
      };
      const text = (q.q ?? '').trim().toLowerCase();
      const day = (d: Date | null | undefined) =>
        d ? new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10) : null;
      const rows = r.rows.filter((x) => {
        if (q.cycleId && x.cycle_id !== q.cycleId) return false;
        if (q.classId && x.class_id !== q.classId) return false;
        if (q.categoryId && x.category_id !== q.categoryId) return false;
        if (q.status && x.status !== q.status) return false;
        if (q.stage && x.stage !== q.stage) return false;
        if (q.level && levelOf(x) !== q.level) return false;
        if (q.overdue && !(x.due_at && x.due_at.getTime() < now)) return false;
        if (
          text &&
          ![x.candidate, x.number, x.mobile].some((v) => (v ?? '').toLowerCase().includes(text))
        )
          return false;
        // dates: waiting since (Waiting for me) or my decision (Decided by me), India dates
        const at = day(q.tab === 'decided' ? decidedAt.get(x.id) : x.level_since);
        if (q.from && (!at || at < q.from)) return false;
        if (q.to && (!at || at > q.to)) return false;
        return true;
      });
      const remarks = await this.remarksOf(
        c,
        rows.map((x) => x.id),
      );
      return {
        waiting: waiting.length,
        decided: decidedRows.length,
        overdue:
          q.tab === 'decided'
            ? 0
            : r.rows.filter((x) => x.due_at && x.due_at.getTime() < now).length,
        total: rows.length,
        options,
        data: rows.slice(0, q.size).map((x) => ({
          id: x.id,
          number: x.number,
          candidate: x.candidate,
          className: x.class_name,
          session: x.session,
          category: x.category,
          status: x.status,
          points: x.form_points !== null ? Number(x.form_points) : null,
          merit: x.merit !== null ? Number(x.merit) : null,
          stage: x.stage,
          level: levelOf(x),
          since: x.level_since?.toISOString() ?? null,
          decidedAt: decidedAt.get(x.id)?.toISOString() ?? null,
          dueAt: x.due_at?.toISOString() ?? null,
          overdue: Boolean(x.due_at && x.due_at.getTime() < now),
          remarks: remarks.get(x.id) ?? [],
        })),
      };
    });
  }

  /** The review: the candidate, the answers by tab, the documents, the points and the stage path. */
  async review(ctx: RequestContext, id: string) {
    const { mayDecide } = await this.db.tenant(requireTenant(ctx), (c) => this.access(c, ctx, id));
    const d = await this.process.detail(ctx, id);
    const def = d.def as AdmissionFormDef;
    const answers = d.answers as AdmissionAnswers;
    const files = d.files as Record<string, { fileId: string; name: string; contentType: string }>;
    const shown = (f: AdmissionField) => fieldState(f, answers).shown;
    const sections = def.steps
      .map((s) => ({
        title: s.title,
        items: def.fields
          .filter(
            (f) =>
              f.step === s.key &&
              !LAYOUT_TYPES.includes(f.type) &&
              !NOT_ASKED.has(f.type) &&
              shown(f),
          )
          .map((f) => ({ label: f.label, value: answerText(f, answers[f.key]) || '-' })),
      }))
      .filter((s) => s.items.length);
    const docs = def.fields
      .filter((f) => (f.type === 'file' || f.type === 'photo') && shown(f))
      .map((f) => {
        const v = answers[f.key];
        const ids = (Array.isArray(v) ? v : typeof v === 'string' && v ? [v] : []).map(String);
        return {
          key: f.key,
          label: f.label,
          files: ids.map((x) => ({
            id: x,
            name: files[x]?.name ?? 'File',
            contentType: files[x]?.contentType ?? '',
          })),
        };
      });
    const photo = docs.find((x) => x.key === 'student_photo' || /photo/.test(x.key))?.files[0]?.id;
    const remarks = await this.db.tenant(requireTenant(ctx), (c) => this.remarksOf(c, [id]));
    return {
      id: d.id,
      number: d.number,
      candidate: d.candidate,
      status: d.status,
      className: d.class.name,
      session: d.session.name,
      category: d.category,
      categoryId: d.categoryId,
      categories: d.categories,
      photoFileId: photo ?? null,
      mayDecide: mayDecide && d.process.canAct,
      current: d.process.current,
      path: d.process.steps,
      points: d.points,
      merit: d.merit,
      sections,
      documents: docs,
      remarks: remarks.get(id) ?? [],
      // the answers the approver may change, tab by tab (docs/design/51)
      edit: mayDecide
        ? def.steps
            .map((st) => ({
              title: st.title,
              fields: def.fields
                .filter((f) => f.step === st.key && EDITABLE.has(f.type) && !SECRET(f) && shown(f))
                .map((f) => {
                  const v = answers[f.key];
                  return {
                    key: f.key,
                    label: f.label,
                    type: f.type,
                    required: Boolean(f.required),
                    options:
                      AdmissionFormsService.optionsOf(
                        f,
                        d.options as Record<string, string[]>,
                        answers,
                      ) ?? null,
                    value:
                      typeof v === 'boolean'
                        ? v
                          ? 'Yes'
                          : 'No'
                        : Array.isArray(v)
                          ? v.map(String)
                          : v === undefined || v === null
                            ? ''
                            : String(v),
                  };
                }),
            }))
            .filter((t) => t.fields.length)
        : [],
      changes: d.answerChanges.slice(0, 50),
      receipts: d.receipts.map((r) => ({
        id: r.id,
        receiptNo: r.receiptNo,
        amount: r.amount,
        date: r.date,
        head: r.head,
      })),
      hasForm: Boolean(d.hasPdf),
      // the questions the approver may send back for correction
      fields: def.fields
        .filter((f) => !LAYOUT_TYPES.includes(f.type) && shown(f))
        .map((f) => ({ key: f.key, label: f.label })),
    };
  }

  async decide(ctx: RequestContext, id: string, dto: ApprovalDecideDto) {
    const a = await this.db.tenant(requireTenant(ctx), (c) => this.access(c, ctx, id));
    if (!a.mayDecide)
      throw new DomainError('admissions.not_yours', 'This registration no longer waits for you', {
        status: 409,
      });
    await this.process.decide(ctx, id, dto);
    return this.review(ctx, id);
  }

  async sendBack(ctx: RequestContext, id: string, dto: SendBackDto) {
    const a = await this.db.tenant(requireTenant(ctx), (c) => this.access(c, ctx, id));
    if (!a.mayDecide)
      throw new DomainError('admissions.not_yours', 'This registration no longer waits for you', {
        status: 409,
      });
    await this.process.sendBack(ctx, id, dto);
    return { ok: true };
  }

  /**
   * The approver corrects answers (docs/design/51): through the office's correction (checked against the
   * form, each change kept with old and new value and who), then the points are worked out again — an
   * approver's edit clears a confirmation — and the fee category matched again from the answers
   * (the default, General, when no rule holds); the registration fee already paid stays as it is.
   */
  async correct(ctx: RequestContext, id: string, dto: ApprovalCorrectDto) {
    const a = await this.db.tenant(requireTenant(ctx), (c) => this.access(c, ctx, id));
    if (!a.mayDecide)
      throw new DomainError('admissions.not_yours', 'This registration no longer waits for you', {
        status: 409,
      });
    const out = await this.process.officeCorrect(ctx, id, dto);
    await this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(
        `UPDATE applications SET points_confirmed_at = NULL, points_confirmed_by = NULL WHERE id = $1`,
        [id],
      );
      await this.core.refreshPoints(c, id);
      const row = await this.core.row(c, id);
      const def = await this.core.defOf(c, row);
      const answers = liveAnswers(def, this.core.plainData(def, row.data));
      const cat = matchCategory(await this.setup.categoriesWith(c, true), answers);
      if (cat && cat.id !== row.category_id) {
        await c.query(
          `UPDATE applications SET category_id = $2, updated_at = now() WHERE id = $1`,
          [id, cat.id],
        );
        await this.core.event(
          c,
          id,
          row.status,
          row.status,
          `Fee category changed to ${cat.name} after a correction${row.application_no ? ' (the registration fee paid stays; the category counts for the admission fee)' : ''}`,
          { actorUser: ctx.user.id },
        );
      }
    });
    return { changed: out.changed, review: await this.review(ctx, id) };
  }

  /** The registration form PDF of a registration the approver may see. */
  async formPdf(ctx: RequestContext, id: string) {
    await this.db.tenant(requireTenant(ctx), (c) => this.access(c, ctx, id));
    return this.desk.pdf(ctx, id);
  }

  /** A payment receipt of that registration. */
  async receiptPdf(ctx: RequestContext, id: string, receiptId: string) {
    await this.db.tenant(requireTenant(ctx), async (c) => {
      await this.access(c, ctx, id);
      const r = await c.query(`SELECT 1 FROM misc_receipts WHERE id = $1 AND application_id = $2`, [
        /^\d{1,18}$/.test(receiptId) ? receiptId : '0',
        id,
      ]);
      if (!r.rows.length) throw new DomainError('not-found', 'Receipt not found', { status: 404 });
    });
    return this.desk.receiptPdf(ctx, receiptId);
  }

  /** The list as it is filtered, to Excel or to a PDF on the letterhead (docs/design/51). */
  async export(ctx: RequestContext, q: ApprovalsQueryDto) {
    const list = await this.list(ctx, { ...q, size: 2000 });
    const cols: string[] = [];
    for (const r of list.data)
      for (const m of r.remarks) {
        const k = `${m.stage} · ${m.levelName}`;
        if (!cols.includes(k)) cols.push(k);
      }
    const remarkAt = (r: (typeof list.data)[number], k: string) => {
      const m = r.remarks.find((x) => `${x.stage} · ${x.levelName}` === k);
      return m
        ? `${DECISION[m.decision] ?? m.decision}${m.remarks ? `: ${m.remarks}` : ''} (${m.by ?? '-'})`
        : '';
    };
    const title =
      q.tab === 'decided'
        ? 'Admission approvals: decided by me'
        : 'Admission approvals: waiting for me';
    const head = [
      'Registration no.',
      'Candidate',
      'Class',
      'Session',
      'Category',
      'Points',
      q.tab === 'decided' ? 'Status' : 'Waiting at',
      ...cols,
    ];
    const cells = (r: (typeof list.data)[number]) => [
      r.number ?? '',
      r.candidate ?? '',
      r.className,
      r.session,
      r.category ?? '',
      r.points === null ? '' : String(r.points),
      q.tab === 'decided'
        ? r.status.replace(/_/g, ' ')
        : `${r.stage ?? ''}${r.level ? ` · ${r.level}` : ''}${r.overdue ? ' (overdue)' : ''}`,
      ...cols.map((k) => remarkAt(r, k)),
    ];
    if (q.format === 'pdf')
      return this.db.tenant(requireTenant(ctx), async (c) => {
        const sc = (
          await c.query<{
            name: string;
            address: string | null;
            contact: string | null;
            logo: string | null;
          }>(
            `SELECT name, NULLIF(concat_ws(', ', NULLIF(btrim(address->>'line1'), ''), NULLIF(btrim(address->>'city'), ''), NULLIF(btrim(address->>'state'), '')), '') AS address,
                    NULLIF(btrim(contact->>'phone'), '') AS contact, NULLIF(branding->>'logoFileId', '') AS logo
               FROM schools WHERE id = app.current_school_id()`,
          )
        ).rows[0]!;
        const bytes = await tablePdf({
          school: {
            name: sc.name,
            address: sc.address,
            contact: sc.contact ? `Phone ${sc.contact}` : null,
          },
          logo: await this.core.fileBytes(c, sc.logo),
          title,
          subtitle: `${String(list.total)} registrations · ${ctx.user.displayName}`,
          columns: [
            { h: 'Registration no.', w: 98 },
            { h: 'Candidate', w: 96 },
            { h: 'Class', w: 50 },
            { h: 'Pts', w: 28 },
            { h: q.tab === 'decided' ? 'Status' : 'Waiting at', w: 90 },
            { h: 'Decisions and remarks', w: 153 },
          ],
          rows: list.data.map((r) => {
            const x = cells(r);
            return [
              x[0]!,
              x[1]!,
              x[2]!,
              x[5]!,
              x[6]!,
              cols
                .map((k) => remarkAt(r, k))
                .filter(Boolean)
                .join(' | '),
            ];
          }),
          printedAt: new Intl.DateTimeFormat('en-IN', {
            timeZone: 'Asia/Kolkata',
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          }).format(new Date()),
        });
        return { bytes, filename: 'admission-approvals.pdf', contentType: 'application/pdf' };
      });
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Approvals');
    ws.addRow([title]).font = { bold: true };
    ws.addRow([`${String(list.total)} registrations`]);
    ws.addRow([]);
    ws.addRow(head).font = { bold: true };
    head.forEach((h, i) => (ws.getColumn(i + 1).width = i >= 7 ? 40 : h === 'Candidate' ? 26 : 18));
    for (const r of list.data) ws.addRow(cells(r));
    return {
      bytes: Buffer.from(await wb.xlsx.writeBuffer()),
      filename: 'admission-approvals.xlsx',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  /** A document of a registration the approver may see (only files its answers name). */
  async file(ctx: RequestContext, id: string, fileId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.access(c, ctx, id);
      const a = await this.core.row(c, id);
      const named = JSON.stringify(a.data ?? {}).includes(`"${fileId}"`);
      if (!named || !/^\d{1,18}$/.test(fileId))
        throw new DomainError('not-found', 'File not found', { status: 404 });
      const f = await this.core.fileBytes(c, fileId);
      if (!f) throw new DomainError('not-found', 'File not found', { status: 404 });
      return f;
    });
  }
}
