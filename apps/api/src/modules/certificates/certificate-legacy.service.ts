import { Injectable } from '@nestjs/common';
import { QUEUES, type PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { OutboxService } from '../../common/jobs/outbox.service';
import { CertificatesService } from './certificates.service';

/**
 * Certificates from the old system (docs/design/87, phase F). The workers read the old register into
 * certificate_legacy_rows; here the school maps each old certificate name to a type (EduPro guesses), previews, then
 * brings them: each a read-only certificate under its old number (a cancelled one cancelled), its record kept as it
 * was and reprinted on the "from the old system" layout; each type's series of each year and the TC book continue
 * from the last number the old system used; the count check shows each old row came or was left out, and why.
 */
type Payload = Record<string, unknown>;
const s = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());

/** An old certificate name → a type (staff for a staff row). */
export function guessType(name: string, staff: boolean): string | null {
  const n = name.toLowerCase();
  if (staff) {
    if (/visa|travel|noc|no objection/.test(n)) return 'STAFF_VISA';
    if (/experience|relieving/.test(n)) return 'EXPERIENCE';
    if (/service|working|salary/.test(n)) return 'SERVICE';
    return null;
  }
  const rules: Array<[RegExp, string]> = [
    [/\btc\b|transfer|leaving|school leaving|\bslc\b/, 'TC'],
    [/bona ?fide/, 'BONAFIDE'],
    [/character|conduct/, 'CHARACTER'],
    [/justif/, 'DOB_JUST'],
    [/birth|\bdob\b/, 'DOB'],
    [/caste|category/, 'CASTE'],
    [/domicile|residen/, 'DOMICILE'],
    [/visa/, 'VISA'],
    [/travel/, 'TRAVEL_NOC'],
    [/\bnoc\b|no objection/, 'NOC'],
    [/scholar/, 'SCHOLAR'],
    [/registration|cbse|board/, 'BOARD_REG'],
    [/\bfee/, 'FEE_PAID'],
    [/study|studying/, 'STUDY'],
    [/merit/, 'MERIT'],
    [/participat/, 'PARTICIPATION'],
    [/achiev/, 'ACHIEVEMENT'],
    [/award|prize/, 'AWARD'],
  ];
  return rules.find(([re]) => re.test(n))?.[1] ?? null;
}

/** "2025-2026" | "2025-26" | "2526" → "2025-26" */
export function yearCodeOf(fy: string): string | null {
  const a = /^(\d{4})\s*-\s*(\d{2,4})$/.exec(fy.trim());
  if (a) return `${a[1]!}-${a[2]!.slice(-2)}`;
  const b = /^(\d{2})(\d{2})$/.exec(fy.trim());
  return b ? `20${b[1]!}-${b[2]!}` : null;
}

/** "TC-2526-00012" → 12 */
export const seqOf = (no: string) => {
  const m = /(\d+)\s*$/.exec(no);
  return m ? Number(m[1]) : null;
};

const dmy = (v: string) =>
  /^\d{4}-\d{2}-\d{2}/.test(v) ? `${v.slice(8, 10)}-${v.slice(5, 7)}-${v.slice(0, 4)}` : v;

/** What the old record held, as label and value, for the reprint (empty ones left out). */
const LABELS: Array<[string, string]> = [
  ['person_name', 'Name'],
  ['sadmission', 'Admission no. / ID'],
  ['father_name', "Father's name"],
  ['mother_name', "Mother's name"],
  ['gender', 'Gender'],
  ['dob', 'Date of birth'],
  ['nationality', 'Nationality'],
  ['category', 'Category'],
  ['Religion', 'Religion'],
  ['Caste', 'Caste'],
  ['MotherTongue', 'Mother tongue'],
  ['PlaceofBirth', 'Place of birth'],
  ['pen_no', 'PEN'],
  ['apaar_id', 'APAAR ID'],
  ['board_roll_no', 'Board roll no.'],
  ['doa', 'Date of admission'],
  ['admission_class', 'Class at admission'],
  ['class_or_dept', 'Class / department'],
  ['last_class', 'Class last studied'],
  ['exam_result', 'Examination last taken, with result'],
  ['failed_same_class', 'Whether failed in the same class'],
  ['subjects_studied', 'Subjects studied'],
  ['promotion_status', 'Qualified for promotion'],
  ['dues_paid', 'Dues paid up to'],
  ['fee_concession', 'Fee concession'],
  ['working_days', 'Working days'],
  ['days_present', 'Days present'],
  ['ncc_scout_guide', 'NCC / Scout / Guide'],
  ['extra_curricular', 'Games and activities'],
  ['general_conduct', 'General conduct'],
  ['application_date', 'Date of application'],
  ['reason_for_leaving', 'Reason for leaving'],
  ['remarks', 'Remarks'],
  ['issue_date', 'Date of issue'],
];
export function legacyFields(p: Payload): Array<{ label: string; value: string }> {
  return LABELS.map(([k, label]) => ({ label, value: dmy(s(p[k])) })).filter((x) => x.value !== '');
}

@Injectable()
export class CertificateLegacyService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly certificates: CertificatesService,
  ) {}

  private async cutover(c: PoolClient) {
    await c.query(
      `INSERT INTO certificate_cutover (school_id) VALUES (app.current_school_id()) ON CONFLICT (school_id) DO NOTHING`,
    );
    return (
      await c.query<{
        read_requested_at: Date | null;
        read_at: Date | null;
        read_error: string | null;
        book_last_sl: number | null;
        type_map: Record<string, string | null>;
        brought_at: Date | null;
        by: string | null;
        brought: Record<string, unknown>;
      }>(
        `SELECT k.read_requested_at, k.read_at, k.read_error, k.book_last_sl, k.type_map, k.brought_at, u.display_name AS by, k.brought
           FROM certificate_cutover k LEFT JOIN users u ON u.id = k.brought_by`,
      )
    ).rows[0]!;
  }

  /** The old rows grouped by their certificate name, with what each maps to. */
  private async groups(c: PoolClient, map: Record<string, string | null>) {
    const r = await c.query<{
      name: string;
      staff: boolean;
      rows: number;
      cancelled: number;
      matched: number;
      brought: number;
    }>(
      `SELECT COALESCE(NULLIF(btrim(l.payload->>'certificate_type'), ''), '(none)') AS name,
              (lower(COALESCE(l.payload->>'user_type', 'student')) LIKE 'staff%' OR lower(COALESCE(l.payload->>'user_type', '')) = 'employee') AS staff,
              count(*)::int AS rows,
              count(*) FILTER (WHERE COALESCE(l.payload->>'isTrash', '0') = '1')::int AS cancelled,
              count(*) FILTER (WHERE EXISTS (SELECT 1 FROM students st WHERE st.deleted_at IS NULL
                                               AND lower(st.admission_no) = lower(COALESCE(NULLIF(l.payload->>'sadmission', ''), l.payload->>'person_id')))
                                   OR EXISTS (SELECT 1 FROM employees em WHERE em.deleted_at IS NULL
                                               AND lower(em.employee_code) = lower(l.payload->>'person_id')))::int AS matched,
              count(*) FILTER (WHERE EXISTS (SELECT 1 FROM certificates x WHERE x.legacy_ref = 'legacy:' || l.srno::text))::int AS brought
         FROM certificate_legacy_rows l
        GROUP BY 1, 2 ORDER BY 3 DESC, 1`,
    );
    return r.rows.map((g) => {
      const key = `${g.name}${g.staff ? ' (staff)' : ''}`;
      const guessed = guessType(g.name, g.staff);
      return {
        key,
        name: g.name,
        staff: g.staff,
        rows: g.rows,
        cancelled: g.cancelled,
        matched: g.matched,
        brought: g.brought,
        guessed,
        mapped: key in map ? map[key] : guessed,
      };
    });
  }

  /** The page: the read, the old names and their types, what came, the numbers that continue, the count check. */
  async state(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.certificates.ensureSetup(c);
      const k = await this.cutover(c);
      const groups = await this.groups(c, k.type_map);
      const types = await c.query<{ code: string; name: string; audience: string }>(
        `SELECT code, name, audience FROM certificate_types ORDER BY sort_order, name`,
      );
      const read = groups.reduce((n, g) => n + g.rows, 0);
      const brought = groups.reduce((n, g) => n + g.brought, 0);
      const series = await this.seriesPlan(c, k.type_map);
      const book = await this.bookPlan(c, k.book_last_sl);
      return {
        read: {
          requestedAt: k.read_requested_at?.toISOString() ?? null,
          at: k.read_at?.toISOString() ?? null,
          error: k.read_error,
          rows: read,
        },
        groups,
        types: types.rows,
        brought: { at: k.brought_at?.toISOString() ?? null, by: k.by, counts: k.brought },
        series,
        book,
        check: {
          read,
          brought,
          left: read - brought,
          ok: read > 0 && brought + this.leftOut(k.brought) === read,
        },
      };
    });
  }

  private leftOut(b: Record<string, unknown>) {
    return Number(b.noType ?? 0) + Number(b.noPerson ?? 0);
  }

  /** For each type and year: the old system's last number and the series now. */
  private async seriesPlan(c: PoolClient, map: Record<string, string | null>) {
    const rows = await c.query<{ name: string; staff: boolean; fy: string; no: string }>(
      `SELECT COALESCE(NULLIF(btrim(payload->>'certificate_type'), ''), '(none)') AS name,
              (lower(COALESCE(payload->>'user_type', 'student')) LIKE 'staff%' OR lower(COALESCE(payload->>'user_type', '')) = 'employee') AS staff,
              COALESCE(payload->>'FinancialYear', '') AS fy, COALESCE(payload->>'certificate_no', '') AS no
         FROM certificate_legacy_rows`,
    );
    const last = new Map<string, number>();
    for (const r of rows.rows) {
      const key = `${r.name}${r.staff ? ' (staff)' : ''}`;
      const code = key in map ? map[key] : guessType(r.name, r.staff);
      const year = yearCodeOf(r.fy);
      const seq = seqOf(r.no);
      if (!code || !year || seq === null) continue;
      const k = `${code}|${year}`;
      last.set(k, Math.max(last.get(k) ?? 0, seq));
    }
    const out = [];
    for (const [k, oldLast] of last) {
      const [typeCode, yearCode] = k.split('|') as [string, string];
      const cur = await c.query<{ n: number }>(
        `SELECT last_serial AS n FROM certificate_series WHERE type_code = $1 AND year_code = $2`,
        [typeCode, yearCode],
      );
      out.push({ typeCode, yearCode, oldLast, current: cur.rows[0]?.n ?? 0 });
    }
    return out.sort(
      (a, b) => a.typeCode.localeCompare(b.typeCode) || a.yearCode.localeCompare(b.yearCode),
    );
  }

  private async bookPlan(c: PoolClient, setting: number | null) {
    const m = await c.query<{ n: number | null }>(
      `SELECT max(NULLIF(payload->>'sl_no', '')::numeric)::int AS n FROM certificate_legacy_rows WHERE (payload->>'sl_no') ~ '^\\d+$'`,
    );
    const cur = await c.query<{ n: number }>(`SELECT last_sl AS n FROM certificate_book_series`);
    return { oldLast: Math.max(setting ?? 0, m.rows[0]?.n ?? 0), current: cur.rows[0]?.n ?? 0 };
  }

  /** Ask the workers to read the old register now (the server's connection). */
  async requestRead(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.cutover(c);
      await c.query(`UPDATE certificate_cutover SET read_requested_at = now(), updated_at = now()`);
      await this.outbox.enqueue(c, ctx, QUEUES.maintenance, 'certificate.legacy_read', {
        schoolIds: [requireTenant(ctx).schoolId],
      });
      return { requested: true };
    });
  }

  /** Which type each old certificate name becomes (null: not brought). */
  async saveMap(ctx: RequestContext, map: Record<string, string | null>) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.cutover(c);
      const codes = [...new Set(Object.values(map).filter((x): x is string => !!x))];
      if (codes.length) {
        const r = await c.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM certificate_types WHERE code = ANY($1::text[])`,
          [codes],
        );
        if ((r.rows[0]?.n ?? 0) !== codes.length)
          throw new DomainError('validation-failed', 'Choose types of this school', {
            status: 400,
          });
      }
      await c.query(`UPDATE certificate_cutover SET type_map = $1::jsonb, updated_at = now()`, [
        JSON.stringify(map),
      ]);
      await this.audit.stage(ctx, c, {
        action: 'certificate.legacy.map',
        entityType: 'certificate_cutover',
        entityId: requireTenant(ctx).schoolId,
        after: { map },
      });
      return { saved: true };
    });
  }

  /**
   * Brings the old certificates (a dry run counts only). Each row once: its type by the map, its person by the
   * admission no. (staff: the employee code), its number and date kept, cancelled when the old system had deleted it,
   * its record kept for the reprint. Then each series and the TC book continue from the old system's last number.
   */
  async bring(ctx: RequestContext, dryRun: boolean) {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      await this.certificates.ensureSetup(c);
      const k = await this.cutover(c);
      const types = new Map(
        (
          await c.query<{ code: string; id: string; name: string; audience: string }>(
            `SELECT code, id::text, name, audience FROM certificate_types`,
          )
        ).rows.map((t) => [t.code, t]),
      );
      const version = (
        await c.query<{ id: string }>(
          `SELECT v.id::text FROM document_template_versions v JOIN document_templates d ON d.id = v.template_id
            WHERE d.ready_code = 'cert_legacy' AND d.deleted_at IS NULL ORDER BY v.version DESC LIMIT 1`,
        )
      ).rows[0]?.id;
      if (!version)
        throw new DomainError('template.missing', 'The reprint layout is missing', { status: 409 });
      const students = new Map(
        (
          await c.query<{ no: string; id: string }>(
            `SELECT lower(admission_no) AS no, id::text FROM students WHERE deleted_at IS NULL`,
          )
        ).rows.map((x) => [x.no, x.id]),
      );
      const staff = new Map(
        (
          await c.query<{ no: string; id: string }>(
            `SELECT lower(employee_code) AS no, id::text FROM employees WHERE deleted_at IS NULL`,
          )
        ).rows.map((x) => [x.no, x.id]),
      );
      const done = new Set(
        (
          await c.query<{ ref: string }>(
            `SELECT legacy_ref AS ref FROM certificates WHERE legacy_ref LIKE 'legacy:%'`,
          )
        ).rows.map((x) => x.ref),
      );
      const counts = { read: 0, brought: 0, already: 0, noType: 0, noPerson: 0, cancelled: 0 };
      const rows = await c.query<{ srno: string; payload: Payload }>(
        `SELECT srno::text, payload FROM certificate_legacy_rows ORDER BY srno`,
      );
      for (const r of rows.rows) {
        counts.read += 1;
        const p = r.payload;
        const ref = `legacy:${r.srno}`;
        if (done.has(ref)) {
          counts.already += 1;
          continue;
        }
        const isStaff = /^(staff|employee)/i.test(s(p.user_type));
        const name = s(p.certificate_type) || '(none)';
        const key = `${name}${isStaff ? ' (staff)' : ''}`;
        const code = key in k.type_map ? k.type_map[key] : guessType(name, isStaff);
        const type = code ? types.get(code) : undefined;
        if (!type) {
          counts.noType += 1;
          continue;
        }
        const pid = (isStaff ? s(p.person_id) : s(p.sadmission) || s(p.person_id)).toLowerCase();
        const personId = isStaff ? staff.get(pid) : students.get(pid);
        if (!personId) {
          counts.noPerson += 1;
          continue;
        }
        const cancelled = s(p.isTrash) === '1';
        if (cancelled) counts.cancelled += 1;
        counts.brought += 1;
        if (dryRun) continue;
        const issuedOn = (
          /^\d{4}-\d{2}-\d{2}/.test(s(p.issue_date)) ? s(p.issue_date) : s(p.CreationDate)
        ).slice(0, 10);
        const day = /^\d{4}-\d{2}-\d{2}$/.test(issuedOn) ? issuedOn : null;
        const number = s(p.certificate_no) || `OLD-${r.srno}`;
        const book = Number(s(p.book_no)) || null;
        const sl = Number(s(p.sl_no)) || null;
        const person = {
          name: s(p.person_name),
          [isStaff ? 'code' : 'admissionNo']: s(p.sadmission) || s(p.person_id),
          fatherName: s(p.father_name),
          motherName: s(p.mother_name),
          className: s(p.class_or_dept),
        };
        const data = {
          [type.audience === 'STAFF' ? 'employee' : 'student']: person,
          cert: { name: type.name, number, issuedOn: day ? dmy(day) : '', bookNo: book, slNo: sl },
          legacyFields: legacyFields(p),
          signs: [{ title: 'Prepared by' }, { title: 'Checked by' }, { title: 'Principal' }],
          footerNote: 'From the record of the school’s earlier system',
        };
        await c.query(
          `INSERT INTO certificates (school_id, type_id, number, serial, year_code, student_id, employee_id, status, issued_on,
                                     data, template_version_id, book_no, sl_no, legacy, legacy_ref, cancelled_at, cancel_reason)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, COALESCE($8::date, CURRENT_DATE), $9::jsonb, $10, $11, $12,
                   true, $13, CASE WHEN $7 = 'cancelled' THEN now() END,
                   CASE WHEN $7 = 'cancelled' THEN 'Deleted in the old system' END)
           ON CONFLICT DO NOTHING`,
          [
            type.id,
            number,
            seqOf(number),
            yearCodeOf(s(p.FinancialYear)),
            isStaff ? null : personId,
            isStaff ? personId : null,
            cancelled ? 'cancelled' : 'issued',
            day,
            JSON.stringify(data),
            version,
            book,
            sl,
            ref,
          ],
        );
      }
      if (dryRun) return { dryRun: true, counts };
      // each series continues after the old system's last number of that type and year; the TC book after its last Sl. No.
      const series = await this.seriesPlan(c, k.type_map);
      for (const x of series)
        await c.query(
          `INSERT INTO certificate_series (school_id, type_code, year_code, last_serial)
           VALUES (app.current_school_id(), $1, $2, $3)
           ON CONFLICT (school_id, type_code, year_code) DO UPDATE SET last_serial = GREATEST(certificate_series.last_serial, EXCLUDED.last_serial)`,
          [x.typeCode, x.yearCode, x.oldLast],
        );
      const book = await this.bookPlan(c, k.book_last_sl);
      if (book.oldLast)
        await c.query(
          `INSERT INTO certificate_book_series (school_id, last_sl) VALUES (app.current_school_id(), $1)
           ON CONFLICT (school_id) DO UPDATE SET last_sl = GREATEST(certificate_book_series.last_sl, EXCLUDED.last_sl), updated_at = now()`,
          [book.oldLast],
        );
      const left = { noType: counts.noType, noPerson: counts.noPerson };
      await c.query(
        `UPDATE certificate_cutover SET brought_at = now(), brought_by = app.current_user_id(),
                brought = $1::jsonb, updated_at = now()`,
        [JSON.stringify({ ...counts, ...left })],
      );
      await this.audit.stage(ctx, c, {
        action: 'certificate.legacy.bring',
        entityType: 'certificate_cutover',
        entityId: tenant.schoolId,
        after: { ...counts },
      });
      return {
        dryRun: false,
        counts,
        series: await this.seriesPlan(c, k.type_map),
        book: await this.bookPlan(c, k.book_last_sl),
      };
    });
  }
}
