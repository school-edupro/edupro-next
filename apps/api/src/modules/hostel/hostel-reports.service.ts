import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { generatedOn, registerFile, schoolHead } from '../attendance/register-file';
import { HOSTEL, HOSTEL_H2 } from './hostel.dto';
import { HOSTEL_WD } from './hostel-withdrawal.dto';
import { HostelLifeService } from './hostel-life.service';
import { HostelWithdrawalsService } from './hostel-withdrawals.service';
import { HostelService } from './hostel.service';
import type { HostelReportId, HostelReportQueryDto } from './hostel-reports.dto';

export interface ReportColumn {
  key: string;
  label: string;
  group?: string;
  /** a column that names the row: always shown */
  fixed?: boolean;
  /** width in the Excel / PDF (characters) */
  width?: number;
  right?: boolean;
}
type Cell = string | number | null | undefined;
export interface HostelReport {
  report: HostelReportId;
  title: string;
  columns: ReportColumn[];
  rows: Array<{ cells: Record<string, Cell>; studentId?: string | null; href: string | null }>;
  total: number;
  choice: {
    columns: Array<{ key: string; label: string; group?: string; fixed: boolean; hidden: boolean }>;
    source: 'user' | 'school' | 'all';
  };
  hidden: string[];
}

/** Who may open each report besides the hostel view right. */
const NEEDS: Record<HostelReportId, string> = {
  register: HOSTEL.view,
  occupancy: HOSTEL.view,
  withdrawals: HOSTEL_WD.view,
  leave: HOSTEL_H2.leave,
};
const TITLE: Record<HostelReportId, string> = {
  register: 'Hostel allotment register',
  occupancy: 'Hostel occupancy',
  withdrawals: 'Hostel withdrawal register',
  leave: 'Hostel leave and outings',
};

/** The parents and the address, offered on every hostel report. */
const CONTACTS: ReportColumn[] = [
  { key: 'father_name', label: 'Name', group: 'Father', width: 14 },
  { key: 'father_mobile', label: 'Mobile', group: 'Father', width: 10 },
  { key: 'father_email', label: 'Email', group: 'Father', width: 16 },
  { key: 'mother_name', label: 'Name', group: 'Mother', width: 14 },
  { key: 'mother_mobile', label: 'Mobile', group: 'Mother', width: 10 },
  { key: 'mother_email', label: 'Email', group: 'Mother', width: 16 },
  { key: 'guardian_name', label: 'Name', group: 'Guardian', width: 14 },
  { key: 'guardian_relation', label: 'Relation', group: 'Guardian', width: 8 },
  { key: 'guardian_mobile', label: 'Mobile', group: 'Guardian', width: 10 },
  { key: 'guardian_email', label: 'Email', group: 'Guardian', width: 16 },
  { key: 'address', label: 'Address', width: 24 },
];

const ADDRESS = (
  col: string,
) => `NULLIF(concat_ws(', ', NULLIF(${col}->>'line1', ''), NULLIF(${col}->>'line2', ''), NULLIF(${col}->>'area', ''),
         NULLIF(${col}->>'city', ''), NULLIF(${col}->>'district', ''), NULLIF(${col}->>'state', ''),
         NULLIF(COALESCE(${col}->>'pincode', ${col}->>'pin'), '')), '')`;
// eslint-disable-next-line no-restricted-syntax -- a fixed SQL fragment; the where and order are written here
const GUARDIAN = (where: string, order: string) => `LEFT JOIN LATERAL (
    SELECT g.display_name AS name, g.mobile, g.email::text AS email, sg.relation::text AS relation, g.address
      FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
     WHERE sg.student_id = s.id AND g.deleted_at IS NULL AND ${where}
     ORDER BY ${order} LIMIT 1)`;

const dmy = (v: string | null | undefined) =>
  v ? v.slice(0, 10).split('-').reverse().join('-') : '';
const at = (v: string | Date | null | undefined) =>
  v
    ? new Date(v).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    : '';
const human = (v: string | null | undefined) =>
  v ? v.replace(/_/g, ' ').replace(/^./, (x) => x.toUpperCase()) : '';

/**
 * The hostel's registers as reports (17 Oct 2026): allotment register, occupancy, withdrawals, leave and
 * outings. Each offers the father, mother and guardian (name, mobile, email) and the address; the user
 * ticks the columns (kept for them, or as the school's default by the hostel set-up right) and the same
 * columns go to the screen, the Excel and the PDF.
 */
@Injectable()
export class HostelReportsService {
  constructor(
    private readonly db: DbService,
    private readonly hostel: HostelService,
    private readonly life: HostelLifeService,
    private readonly withdrawals: HostelWithdrawalsService,
  ) {}

  private assertMay(ctx: RequestContext, id: HostelReportId) {
    if (!ctx.permissions?.has(NEEDS[id]))
      throw new DomainError('permission-denied', 'You may not open this report', {
        status: 403,
        extra: { permission: NEEDS[id] },
      });
  }

  /** Father, mother, guardian and address of each pupil. */
  private async contacts(c: PoolClient, ids: string[]) {
    if (!ids.length) return new Map<string, Record<string, Cell>>();
    const r = await c.query<Record<string, string | null> & { sid: string }>(
      // eslint-disable-next-line no-restricted-syntax -- fixed fragments (GUARDIAN, ADDRESS); values are bound
      `SELECT s.id::text AS sid,
              fa.name AS father_name, fa.mobile AS father_mobile, fa.email AS father_email,
              mo.name AS mother_name, mo.mobile AS mother_mobile, mo.email AS mother_email,
              gu.name AS guardian_name, gu.relation AS guardian_relation, gu.mobile AS guardian_mobile, gu.email AS guardian_email,
              COALESCE(${ADDRESS('s.address')}, ${ADDRESS('pg.address')}) AS address
         FROM students s
         ${GUARDIAN(`sg.relation = 'father'`, 'sg.is_primary DESC, sg.id')} fa ON true
         ${GUARDIAN(`sg.relation = 'mother'`, 'sg.is_primary DESC, sg.id')} mo ON true
         ${GUARDIAN(`sg.relation NOT IN ('father', 'mother')`, 'sg.is_primary DESC, sg.receives_notifications DESC, sg.id')} gu ON true
         ${GUARDIAN('true', 'sg.is_primary DESC, sg.receives_notifications DESC, sg.id')} pg ON true
        WHERE s.id = ANY($1::bigint[])`,
      [[...new Set(ids)]],
    );
    return new Map(
      r.rows.map(({ sid, ...x }) => [
        sid,
        { ...x, guardian_relation: human(x.guardian_relation) } as Record<string, Cell>,
      ]),
    );
  }

  /** The rows of a report, before the column choice. */
  private async base(ctx: RequestContext, id: HostelReportId, q: HostelReportQueryDto) {
    type Row = { cells: Record<string, Cell>; studentId?: string | null; href: string | null };
    if (id === 'register') {
      const rows = (await this.hostel.register(ctx, {
        hostelId: q.hostelId,
        from: q.from,
        to: q.to,
        open: q.open ?? 'all',
        q: q.q,
      })) as Array<Record<string, string | null>>;
      const STATUS: Record<string, string> = {
        transfer: 'Moved to another bed',
        vacate: 'Left the hostel',
        withdrawn: 'Left the school',
      };
      const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
      return {
        columns: [
          { key: 'admission_no', label: 'Admission no.', fixed: true, width: 9 },
          { key: 'pupil', label: 'Pupil', fixed: true, width: 16 },
          { key: 'class', label: 'Class', width: 6 },
          { key: 'hostel', label: 'Hostel', width: 12 },
          { key: 'block', label: 'Block', width: 7 },
          { key: 'room_bed', label: 'Room · Bed', fixed: true, width: 8 },
          { key: 'room_type', label: 'Room type', width: 10 },
          { key: 'from', label: 'From', width: 8 },
          { key: 'to', label: 'To', width: 8 },
          { key: 'status', label: 'Status', width: 12 },
        ] as ReportColumn[],
        rows: rows.map((x): Row => ({
          studentId: x.studentId,
          href: `/hostel/allot?student=${String(x.studentId)}`,
          cells: {
            admission_no: x.admissionNo,
            pupil: x.name,
            class: x.section,
            hostel: x.hostel,
            block: x.block,
            room_bed: `${String(x.roomNo)} · ${String(x.bed)}`,
            room_type: x.roomType,
            from: dmy(x.fromDate),
            to: dmy(x.toDate),
            status:
              x.toDate && x.toDate < today
                ? (STATUS[x.endReason ?? ''] ?? 'Ended')
                : x.toDate
                  ? `Staying (leaves ${dmy(x.toDate)})`
                  : 'Staying',
          },
        })),
      };
    }
    if (id === 'occupancy') {
      const rows = await this.db.tenant(requireTenant(ctx), async (c) => {
        const only = await this.hostel.scope(ctx, c);
        const r = await c.query<Record<string, string | null>>(
          `SELECT s.id::text AS "studentId", s.display_name AS name, s.admission_no AS "admissionNo",
                  (SELECT k.code || '-' || cs.name FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id
                     JOIN classes k ON k.id = cs.class_id
                    WHERE e.student_id = s.id AND e.academic_year_id = $3 ORDER BY (e.status = 'active') DESC, e.id DESC LIMIT 1) AS section,
                  h.name AS hostel, bl.name AS block, r.floor::text AS floor, r.room_no AS "roomNo", b.label AS bed,
                  t.name AS "roomType", a.from_date::text AS "fromDate"
             FROM hostel_allotments a JOIN students s ON s.id = a.student_id
             JOIN hostel_beds b ON b.id = a.bed_id JOIN hostel_rooms r ON r.id = b.room_id
             JOIN hostels h ON h.id = r.hostel_id LEFT JOIN hostel_blocks bl ON bl.id = r.block_id
             JOIN hostel_room_types t ON t.id = r.room_type_id
            WHERE a.from_date <= CURRENT_DATE AND (a.to_date IS NULL OR a.to_date >= CURRENT_DATE)
              AND ($1::bigint IS NULL OR h.id = $1) AND ($2::bigint[] IS NULL OR h.id = ANY($2::bigint[]))
              AND ($4::text IS NULL OR s.search_text LIKE '%' || app.search_text($4) || '%')
            ORDER BY h.name, bl.name NULLS FIRST, r.floor, r.room_no, b.label
            LIMIT 3000`,
          [q.hostelId ?? null, only, requireTenant(ctx).academicYearId ?? null, q.q ?? null],
        );
        return r.rows;
      });
      return {
        columns: [
          { key: 'hostel', label: 'Hostel', width: 12 },
          { key: 'block', label: 'Block', width: 7 },
          { key: 'floor', label: 'Floor', width: 5, right: true },
          { key: 'room_bed', label: 'Room · Bed', fixed: true, width: 8 },
          { key: 'room_type', label: 'Room type', width: 10 },
          { key: 'admission_no', label: 'Admission no.', fixed: true, width: 9 },
          { key: 'pupil', label: 'Pupil', fixed: true, width: 16 },
          { key: 'class', label: 'Class', width: 6 },
          { key: 'since', label: 'Since', width: 8 },
        ] as ReportColumn[],
        rows: rows.map((x): Row => ({
          studentId: x.studentId,
          href: `/hostel/allot?student=${String(x.studentId)}`,
          cells: {
            hostel: x.hostel,
            block: x.block,
            floor: x.floor === '0' ? 'Ground' : x.floor,
            room_bed: `${String(x.roomNo)} · ${String(x.bed)}`,
            room_type: x.roomType,
            admission_no: x.admissionNo,
            pupil: x.name,
            class: x.section,
            since: dmy(x.fromDate),
          },
        })),
      };
    }
    if (id === 'withdrawals') {
      const { rows } = await this.withdrawals.list(ctx, {
        status: q.status ?? 'all',
        mine: q.mine,
        hostelId: q.hostelId,
        leavingFrom: q.from,
        leavingTo: q.to,
        q: q.q,
        page: 1,
        size: 2000,
      });
      const REASON: Record<string, string> = {
        parent_request: "Parent's request",
        discipline: 'Discipline',
        health: 'Health',
        other: 'Other',
      };
      const STATUS: Record<string, string> = {
        requested: 'Waiting for approval',
        cleared: 'Approved, to complete',
        completed: 'Left the hostel',
        cancelled: 'Cancelled',
        rejected: 'Not approved',
      };
      return {
        columns: [
          { key: 'admission_no', label: 'Admission no.', fixed: true, width: 9 },
          { key: 'pupil', label: 'Pupil', fixed: true, width: 16 },
          { key: 'class', label: 'Class', width: 6 },
          { key: 'hostel', label: 'Hostel', width: 12 },
          { key: 'room_bed', label: 'Room · Bed', width: 8 },
          { key: 'asked', label: 'Asked on', width: 8 },
          { key: 'leaving', label: 'Leaving on', width: 8 },
          { key: 'reason', label: 'Reason', width: 10 },
          { key: 'charges', label: 'Charges', width: 8, right: true },
          { key: 'fee_until', label: 'Fee up to', width: 8 },
          { key: 'waiting', label: 'Waiting with', width: 12 },
          { key: 'status', label: 'Status', width: 12 },
        ] as ReportColumn[],
        rows: rows.map((w): Row => ({
          studentId: w.studentId,
          href: `/hostel/withdrawals/${w.id}`,
          cells: {
            admission_no: w.admissionNo,
            pupil: w.studentName,
            class: w.section,
            hostel: w.hostelName,
            room_bed: w.place,
            asked: dmy(w.requestedOn),
            leaving: dmy(w.leavingOn),
            reason: REASON[w.reason] ?? w.reason,
            charges: Number(w.damageCharge) + Number(w.messCharge) || null,
            fee_until: w.feeUntil
              ? new Date(`${w.feeUntil}T00:00:00Z`).toLocaleDateString('en-IN', {
                  month: 'short',
                  year: 'numeric',
                  timeZone: 'UTC',
                })
              : '',
            waiting: w.status === 'requested' ? (w.waitingWith ?? '') : '',
            status: STATUS[w.status] ?? w.status,
          },
        })),
      };
    }
    // leave and outings
    const rows = (await this.life.leaves(ctx, {
      hostelId: q.hostelId,
      show: q.show ?? 'all',
    })) as Array<Record<string, string | number | boolean | null>>;
    const STATE: Record<string, string> = {
      pending: 'Waiting for approval',
      approved: 'Approved',
      rejected: 'Not approved',
      out: 'Out',
      returned: 'Back',
      cancelled: 'Cancelled',
    };
    return {
      columns: [
        { key: 'number', label: 'Pass', fixed: true, width: 8 },
        { key: 'kind', label: 'Kind', width: 8 },
        { key: 'admission_no', label: 'Admission no.', fixed: true, width: 9 },
        { key: 'pupil', label: 'Pupil', fixed: true, width: 16 },
        { key: 'hostel', label: 'Hostel', width: 12 },
        { key: 'date', label: 'Date', width: 8 },
        { key: 'return_by', label: 'Back by', width: 12 },
        { key: 'out_at', label: 'Went out', width: 12 },
        { key: 'in_at', label: 'Came back', width: 12 },
        { key: 'late', label: 'Late (min)', width: 6, right: true },
        { key: 'reason', label: 'Reason', width: 14 },
        { key: 'escort', label: 'Escort', width: 14 },
        { key: 'state', label: 'Status', width: 10 },
      ] as ReportColumn[],
      rows: rows.map((x): Row => ({
        studentId: x.studentId as string,
        href: null,
        cells: {
          number: x.number as string,
          kind: x.kind === 'hostel_home' ? 'Home leave' : 'Outing',
          admission_no: x.admissionNo as string,
          pupil: x.name as string,
          hostel: x.hostel as string,
          date: dmy(x.onDate as string),
          return_by: at(x.returnBy as string),
          out_at: at(x.outAt as string),
          in_at: at(x.inAt as string),
          late: (x.lateMinutes as number | null) || null,
          reason: x.reason as string,
          escort: [x.escortName, x.escortRelation ? `(${String(x.escortRelation)})` : null]
            .filter(Boolean)
            .join(' '),
          state: x.overdue ? 'Out, overdue' : (STATE[x.state as string] ?? (x.state as string)),
        },
      })),
    };
  }

  // ---- which columns a report shows: the user's own choice, else the school's default ---------------
  private async layout(c: PoolClient, ctx: RequestContext, id: HostelReportId) {
    const mine = await c.query<{ value: { hidden?: unknown } | null }>(
      `SELECT value FROM user_preferences WHERE user_id = $1 AND pref_key = $2`,
      [ctx.user.id, `hostel.report.${id}`],
    );
    const school = await c.query<{ v: Record<string, unknown> | null }>(
      `SELECT app.setting('hostel.report_columns') AS v`,
    );
    const list = (v: unknown) =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : null;
    return {
      user: mine.rows[0] ? list(mine.rows[0].value?.hidden) : null,
      school: list(school.rows[0]?.v?.[id]) ?? [],
    };
  }

  async report(
    ctx: RequestContext,
    id: HostelReportId,
    q: HostelReportQueryDto,
  ): Promise<HostelReport> {
    this.assertMay(ctx, id);
    const b = await this.base(ctx, id, q);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const contacts = await this.contacts(
        c,
        b.rows.map((r) => r.studentId).filter((x): x is string => !!x),
      );
      const all = [...b.columns, ...CONTACTS];
      const lay = await this.layout(c, ctx, id);
      const chosen = new Set(lay.user ?? lay.school);
      const isHidden = (col: ReportColumn) => !col.fixed && chosen.has(col.key);
      const columns = all.filter((col) => !isHidden(col));
      return {
        report: id,
        title: TITLE[id],
        columns,
        rows: b.rows.map((r) => ({
          ...r,
          cells: { ...r.cells, ...(r.studentId ? (contacts.get(r.studentId) ?? {}) : {}) },
        })),
        total: b.rows.length,
        choice: {
          columns: all.map((col) => ({
            key: col.key,
            label: col.label,
            group: col.group,
            fixed: !!col.fixed,
            hidden: isHidden(col),
          })),
          source: lay.user ? 'user' : lay.school.length ? 'school' : 'all',
        },
        hidden: all
          .filter(isHidden)
          .map((col) => (col.group ? `${col.group}: ${col.label}` : col.label)),
      };
    });
  }

  /** The report as on the screen (its columns and filters), as Excel or PDF made at once. */
  async file(
    ctx: RequestContext,
    id: HostelReportId,
    q: HostelReportQueryDto,
    format: 'xlsx' | 'pdf',
  ) {
    const r = await this.report(ctx, id, q);
    const head = await this.db.tenant(requireTenant(ctx), (c) => schoolHead(c));
    const filters = [
      q.from ? `from ${dmy(q.from)}` : null,
      q.to ? `to ${dmy(q.to)}` : null,
      q.status && q.status !== 'all' ? human(q.status) : null,
      q.show && q.show !== 'all' ? human(q.show) : null,
      q.open && q.open !== 'all' ? (q.open === 'open' ? 'staying now' : 'ended stays') : null,
      q.q ? `“${q.q}”` : null,
      `${String(r.total)} record(s)`,
    ].filter(Boolean) as string[];
    return registerFile(
      {
        school: head.name,
        address: head.address,
        report: r.title,
        details: [filters.join(' · '), generatedOn()],
        legend: r.hidden.length ? `Columns left out: ${r.hidden.join(', ')}` : '',
        columns: [
          { label: 'Sr', width: 3, right: true },
          ...r.columns.map((col) => ({
            label: col.label,
            width: col.width ?? 8,
            right: col.right,
            group: col.group,
          })),
        ],
        rows: r.rows.map((row, i) => [
          i + 1,
          ...r.columns.map((col) => {
            const v = row.cells[col.key];
            return v === null || v === undefined ? '' : v;
          }),
        ]),
        filename: `hostel-${id}`,
        fontSize: r.columns.length > 18 ? 6 : r.columns.length > 12 ? 7 : undefined,
      },
      format,
    );
  }

  /** The user's own columns for a report, or (with the hostel set-up right) the school's default. */
  async saveColumns(
    ctx: RequestContext,
    id: HostelReportId,
    dto: { hidden: string[]; scope: 'user' | 'school' },
  ) {
    this.assertMay(ctx, id);
    const hidden = [...new Set(dto.hidden)];
    if (dto.scope === 'school' && !ctx.permissions?.has(HOSTEL.setup))
      throw new DomainError(
        'permission-denied',
        'Setting the school default needs the hostel set-up right',
        { status: 403, extra: { permission: HOSTEL.setup } },
      );
    return this.db.tenant(requireTenant(ctx), async (c) => {
      if (dto.scope === 'user') {
        await c.query(
          `INSERT INTO user_preferences (school_id, user_id, pref_key, value)
           VALUES (app.current_school_id(), $1, $2, $3::jsonb)
           ON CONFLICT (school_id, user_id, pref_key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
          [ctx.user.id, `hostel.report.${id}`, JSON.stringify({ hidden })],
        );
        return { scope: 'user', hidden };
      }
      const cur = await c.query<{ v: Record<string, string[]> | null }>(
        `SELECT app.setting('hostel.report_columns') AS v`,
      );
      const next = { ...(cur.rows[0]?.v ?? {}), [id]: hidden };
      // as SettingsService.set: close the open row, replace today's, insert the new value
      await c.query(
        `UPDATE school_settings SET valid_to = CURRENT_DATE - 1, updated_by = app.current_user_id()
          WHERE key = 'hostel.report_columns' AND valid_to IS NULL AND valid_from < CURRENT_DATE`,
      );
      await c.query(
        `DELETE FROM school_settings WHERE key = 'hostel.report_columns' AND valid_from = CURRENT_DATE`,
      );
      await c.query(
        `INSERT INTO school_settings (school_id, key, value, valid_from, created_by, updated_by)
         VALUES (app.current_school_id(), 'hostel.report_columns', $1::jsonb, CURRENT_DATE, app.current_user_id(), app.current_user_id())`,
        [JSON.stringify(next)],
      );
      await c.query(`DELETE FROM user_preferences WHERE user_id = $1 AND pref_key = $2`, [
        ctx.user.id,
        `hostel.report.${id}`,
      ]);
      return { scope: 'school', hidden };
    });
  }

  async resetColumns(ctx: RequestContext, id: HostelReportId) {
    await this.db.tenant(requireTenant(ctx), (c) =>
      c.query(`DELETE FROM user_preferences WHERE user_id = $1 AND pref_key = $2`, [
        ctx.user.id,
        `hostel.report.${id}`,
      ]),
    );
    return { reset: true };
  }
}
