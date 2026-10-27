import { Injectable } from '@nestjs/common';
import { admissionWaitingFor, type PoolClient } from '@edupro/db';
import ExcelJS from 'exceljs';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { AdmissionApprovalsService } from './approvals.service';
import { ADMISSION_SETUP_MANAGE } from './process.service';

/** The sheet's own key cell: which session, class, stage and level it was made for. */
const KEY = /^EPAPPR:(\d{1,18}):(\d{1,18}):(\d{1,18}):(\d{1,2})$/;
const HEAD_ROW = 5;
const MAX_ROWS = 2000;
const MAX_BYTES = 5 * 1024 * 1024;
const DECISIONS: Record<
  string,
  Record<string, 'approve' | 'hold' | 'reject' | 'offer' | 'waitlist'>
> = {
  // a selection stage offers or waitlists; every other stage approves
  selection: { Offer: 'offer', 'Waiting list': 'waitlist', Hold: 'hold', Reject: 'reject' },
  other: { Approve: 'approve', Hold: 'hold', Reject: 'reject' },
};

interface Place {
  cycleId: string;
  classId: string;
  stageId: string;
  level: number;
}
interface Waiting {
  id: string;
  number: string | null;
  candidate: string | null;
  category: string | null;
  points: string | null;
  since: Date | null;
}

/**
 * Decisions by Excel (docs/design/55): one sheet per session, class, stage and level, made from the
 * approval set-up (the decision choices of that stage, marks when it has them); the upload is checked
 * row by row and previewed, then each good row is decided as on the review page (events, messages,
 * on behalf for an admin).
 */
@Injectable()
export class AdmissionApprovalsSheetService {
  constructor(
    private readonly db: DbService,
    private readonly approvals: AdmissionApprovalsService,
  ) {}

  /** The registrations this user may decide (an admin: every one waiting). */
  private async visible(c: PoolClient, ctx: RequestContext): Promise<Set<string> | null> {
    if (ctx.permissions?.has(ADMISSION_SETUP_MANAGE)) return null;
    return admissionWaitingFor(c, ctx.user.id);
  }

  /** Where a sheet can be made: each session, class, stage and level with registrations waiting. */
  async options(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const mine = await this.visible(c, ctx);
      const r = await c.query<{
        id: string;
        cycle_id: string;
        cycle: string;
        class_id: string;
        class_name: string;
        stage_id: string;
        stage: string;
        kind: string;
        level_no: number;
        level_name: string | null;
      }>(
        `SELECT w.id::text, w.cycle_id::text, y.name AS cycle, w.class_id::text, cl.name AS class_name,
                (w.step ->> 'stageId') AS stage_id, st.name AS stage, st.kind, w.level_no, w.level ->> 'name' AS level_name
           FROM admission_waiting w JOIN admission_cycles y ON y.id = w.cycle_id JOIN classes cl ON cl.id = w.class_id
           JOIN admission_stages st ON st.id = (w.step ->> 'stageId')::bigint`,
      );
      const groups = new Map<string, { label: string; value: string; count: number }>();
      for (const x of r.rows) {
        if (mine && !mine.has(x.id)) continue;
        const value = `${x.cycle_id}:${x.class_id}:${x.stage_id}:${String(x.level_no)}`;
        const g = groups.get(value) ?? {
          value,
          label: `${x.cycle} · ${x.class_name} · ${x.stage} · ${x.level_name ?? `Level ${String(x.level_no)}`}`,
          count: 0,
        };
        g.count += 1;
        groups.set(value, g);
      }
      return { data: [...groups.values()].sort((a, b) => a.label.localeCompare(b.label)) };
    });
  }

  private async place(c: PoolClient, p: Place) {
    const s = await c.query<{
      cycle: string;
      class_name: string;
      stage: string;
      kind: string;
      max_marks: string | null;
      has_paper: boolean;
    }>(
      `SELECT y.name AS cycle, cl.name AS class_name, st.name AS stage, st.kind,
              app.admission_stage_max(st.id, cl.id)::text AS max_marks,
              EXISTS (SELECT 1 FROM admission_papers p JOIN admission_paper_parts pp ON pp.paper_id = p.id AND pp.status = 'active'
                       WHERE p.stage_id = st.id AND p.class_id = cl.id) AS has_paper
         FROM admission_cycles y, classes cl, admission_stages st WHERE y.id = $1 AND cl.id = $2 AND st.id = $3`,
      [p.cycleId, p.classId, p.stageId],
    );
    const x = s.rows[0];
    if (!x) throw new DomainError('not-found', 'That stage is not set up', { status: 404 });
    return {
      ...x,
      // a class with a paper takes its marks part by part on Test results (docs/design/57)
      maxMarks: x.max_marks !== null && !x.has_paper ? Number(x.max_marks) : null,
      choices: DECISIONS[x.kind === 'selection' ? 'selection' : 'other']!,
    };
  }

  private async waiting(c: PoolClient, ctx: RequestContext, p: Place): Promise<Waiting[]> {
    const mine = await this.visible(c, ctx);
    const r = await c.query<Waiting>(
      `SELECT w.id::text, w.application_no AS number, w.candidate_name AS candidate, k.name AS category,
              a.form_points::text AS points, w.level_since AS since
         FROM admission_waiting w JOIN applications a ON a.id = w.id
         LEFT JOIN admission_fee_categories k ON k.id = a.category_id
        WHERE w.cycle_id = $1 AND w.class_id = $2 AND (w.step ->> 'stageId') = $3 AND w.level_no = $4
        ORDER BY a.form_points DESC NULLS LAST, w.application_no`,
      [p.cycleId, p.classId, p.stageId, p.level],
    );
    return r.rows.filter((x) => !mine || mine.has(x.id));
  }

  /** The sheet of one level: locked keys, a drop-down of the stage's decisions, marks when it has them. */
  async sheet(ctx: RequestContext, p: Place) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const at = await this.place(c, p);
      const rows = await this.waiting(c, ctx, p);
      const levelName = (
        await c.query<{ name: string | null }>(
          `SELECT w.level ->> 'name' AS name FROM admission_waiting w
            WHERE w.cycle_id = $1 AND w.class_id = $2 AND (w.step ->> 'stageId') = $3 AND w.level_no = $4 LIMIT 1`,
          [p.cycleId, p.classId, p.stageId, p.level],
        )
      ).rows[0]?.name;
      const earlier = new Map<string, string>();
      if (rows.length) {
        const e = await c.query<{ id: string; text: string }>(
          `SELECT x.application_id::text AS id,
                  string_agg(st.name || ' L' || x.level || ': ' || x.decision || COALESCE(' (' || x.remarks || ')', ''), '; ' ORDER BY x.decided_at) AS text
             FROM admission_stage_results x JOIN admission_stages st ON st.id = x.stage_id
            WHERE x.application_id = ANY($1::bigint[]) AND x.undone_at IS NULL GROUP BY x.application_id`,
          [rows.map((x) => x.id)],
        );
        for (const x of e.rows) earlier.set(x.id, x.text);
      }
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Decisions');
      const level = levelName ?? `Level ${String(p.level)}`;
      ws.getCell('A1').value = `Approval sheet: ${at.stage} · ${level}`;
      ws.getCell('A1').font = { bold: true, size: 13 };
      ws.getCell('A2').value =
        `${at.cycle} · ${at.class_name} · made ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} by ${ctx.user.displayName}. Fill Decision and Remark; leave Decision empty to skip a row.${at.has_paper ? ' Marks are entered part by part on Test results; a decision here carries their total.' : ''}`;
      ws.getCell('A3').value = `EPAPPR:${p.cycleId}:${p.classId}:${p.stageId}:${String(p.level)}`;
      ws.getCell('B3').value = 'Do not change row 3 or the Registration no. column.';
      ws.getCell('A3').font = { color: { argb: 'FF888888' }, size: 8 };
      const head = [
        'Registration no.',
        'Candidate',
        'Category',
        'Points',
        'Waiting since',
        'Earlier decisions',
        ...(at.maxMarks ? [`Marks (of ${String(at.maxMarks)})`] : []),
        'Decision',
        'Remark',
      ];
      const hr = ws.getRow(HEAD_ROW);
      hr.values = head;
      hr.font = { bold: true };
      const widths = [24, 26, 16, 8, 14, 40, ...(at.maxMarks ? [12] : []), 16, 40];
      widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
      const decisionCol = head.indexOf('Decision') + 1;
      const marksCol = at.maxMarks ? head.indexOf(`Marks (of ${String(at.maxMarks)})`) + 1 : 0;
      const remarkCol = head.indexOf('Remark') + 1;
      rows.forEach((x, i) => {
        const row = ws.getRow(HEAD_ROW + 1 + i);
        row.values = [
          x.number ?? '',
          x.candidate ?? '',
          x.category ?? '',
          x.points !== null ? Number(x.points) : '',
          x.since ? new Date(x.since.getTime() + 330 * 60_000).toISOString().slice(0, 10) : '',
          earlier.get(x.id) ?? '',
        ];
        row.getCell(decisionCol).dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: [`"${Object.keys(at.choices).join(',')}"`],
          showErrorMessage: true,
          errorTitle: 'Decision',
          error: `Choose ${Object.keys(at.choices).join(', ')}`,
        };
        if (marksCol)
          row.getCell(marksCol).dataValidation = {
            type: 'decimal',
            operator: 'between',
            allowBlank: true,
            formulae: [0, at.maxMarks!],
            showErrorMessage: true,
            error: `Marks from 0 to ${String(at.maxMarks)}`,
          };
        for (const col of [decisionCol, remarkCol, ...(marksCol ? [marksCol] : [])])
          row.getCell(col).protection = { locked: false };
      });
      await ws.protect('', {
        selectLockedCells: true,
        selectUnlockedCells: true,
        formatColumns: true,
      });
      return {
        filename: `Approval-${at.stage}-${level}-${at.class_name}.xlsx`.replace(/[^\w.-]+/g, '-'),
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        base64: Buffer.from(await wb.xlsx.writeBuffer()).toString('base64'),
        rows: rows.length,
      };
    });
  }

  /** The filled sheet checked row by row; with apply, the good rows decided. */
  async upload(
    ctx: RequestContext,
    body: unknown,
    apply: boolean,
    offerMessage?: { subject?: string; intro?: string; note?: string },
  ) {
    if (!Buffer.isBuffer(body) || !body.length)
      throw new DomainError('validation-failed', 'Upload the filled sheet (.xlsx)', {
        status: 400,
      });
    if (body.length > MAX_BYTES)
      throw new DomainError('validation-failed', 'The sheet is larger than 5 MB', { status: 400 });
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(body as unknown as ArrayBuffer);
    } catch {
      throw new DomainError('validation-failed', 'That file is not an Excel sheet (.xlsx)', {
        status: 400,
      });
    }
    const ws = wb.worksheets[0];
    const text = (v: ExcelJS.CellValue): string => {
      if (v === null || v === undefined) return '';
      if (typeof v === 'object' && 'richText' in v) return v.richText.map((t) => t.text).join('');
      if (typeof v === 'object' && 'result' in v) return String(v.result ?? '');
      if (typeof v === 'object' && 'text' in v) return String(v.text);
      return String(v);
    };
    const key = ws ? KEY.exec(text(ws.getCell('A3').value).trim()) : null;
    if (!ws || !key)
      throw new DomainError(
        'validation-failed',
        'This is not an approval sheet made here: download the sheet of the level first',
        { status: 400 },
      );
    const p: Place = {
      cycleId: key[1]!,
      classId: key[2]!,
      stageId: key[3]!,
      level: Number(key[4]),
    };
    const head = (ws.getRow(HEAD_ROW).values as ExcelJS.CellValue[]).map((v) => text(v).trim());
    const col = (name: RegExp) => head.findIndex((h) => name.test(h));
    const cNo = col(/^Registration no\.$/);
    const cDecision = col(/^Decision$/);
    const cRemark = col(/^Remark$/);
    const cMarks = col(/^Marks \(of /);
    if (cNo < 1 || cDecision < 1 || cRemark < 1)
      throw new DomainError(
        'validation-failed',
        "The sheet's columns were changed: download it again",
        {
          status: 400,
        },
      );
    const tenant = requireTenant(ctx);
    const { at, waiting } = await this.db.tenant(tenant, async (c) => ({
      at: await this.place(c, p),
      waiting: await this.waiting(c, ctx, p),
    }));
    const byNo = new Map(waiting.filter((x) => x.number).map((x) => [x.number!, x]));
    const out: Array<{
      row: number;
      /** the registration (an offer row is previewed before it is applied) */
      id: string | null;
      offer: boolean;
      number: string;
      candidate: string | null;
      decision: string | null;
      status: 'ok' | 'skipped' | 'error' | 'done';
      reason: string | null;
    }> = [];
    const seen = new Set<string>();
    const last = Math.min(ws.rowCount, HEAD_ROW + MAX_ROWS);
    for (let n = HEAD_ROW + 1; n <= last; n += 1) {
      const r = ws.getRow(n);
      const number = text(r.getCell(cNo).value).trim();
      if (!number) continue;
      const label = text(r.getCell(cDecision).value).trim();
      const remark = text(r.getCell(cRemark).value).trim();
      const marksText = cMarks > 0 ? text(r.getCell(cMarks).value).trim() : '';
      const w = byNo.get(number);
      const line = {
        row: n,
        id: w?.id ?? null,
        offer: at.choices[label] === 'offer',
        number,
        candidate: w?.candidate ?? null,
        decision: label || null,
        status: 'ok' as 'ok' | 'skipped' | 'error' | 'done',
        reason: null as string | null,
      };
      const decision = at.choices[label];
      const marks = marksText ? Number(marksText) : null;
      if (!label) {
        line.status = 'skipped';
        line.reason = 'No decision';
      } else if (seen.has(number)) {
        line.status = 'error';
        line.reason = 'The same registration twice';
      } else if (!w) {
        line.status = 'skipped';
        line.reason = 'No longer waiting at this level for you (decided meanwhile?)';
      } else if (!decision) {
        line.status = 'error';
        line.reason = `Decision must be ${Object.keys(at.choices).join(', ')}`;
      } else if (remark.length < 3) {
        line.status = 'error';
        line.reason = 'Write a remark (at least 3 letters)';
      } else if (
        marks !== null &&
        (!Number.isFinite(marks) || marks < 0 || (at.maxMarks !== null && marks > at.maxMarks))
      ) {
        line.status = 'error';
        line.reason = `Marks from 0 to ${String(at.maxMarks ?? '')}`;
      }
      seen.add(number);
      if (apply && line.status === 'ok' && w && decision) {
        try {
          await this.approvals.decide(ctx, w.id, {
            decision,
            remarks: remark,
            ...(marks !== null ? { marks } : {}),
            ...(decision === 'offer' && offerMessage ? { offerMessage } : {}),
          } as never);
          line.status = 'done';
        } catch (e) {
          line.status = 'error';
          line.reason = e instanceof DomainError ? e.message : 'Not decided';
        }
      }
      out.push(line);
    }
    if (ws.rowCount > HEAD_ROW + MAX_ROWS)
      throw new DomainError('validation-failed', `At most ${String(MAX_ROWS)} rows in one sheet`, {
        status: 400,
      });
    const count = (s: string) => out.filter((x) => x.status === s).length;
    return {
      place: `${at.cycle} · ${at.class_name} · ${at.stage} · Level ${String(p.level)}`,
      applied: apply,
      ok: count('ok'),
      done: count('done'),
      skipped: count('skipped'),
      errors: count('error'),
      rows: out,
    };
  }
}
