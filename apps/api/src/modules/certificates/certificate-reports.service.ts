import { Injectable } from '@nestjs/common';
import { DbService } from '../../common/db/db.service';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { generatedOn, registerFile, schoolHead } from '../attendance/register-file';
import type {
  ReportsFileQueryDto,
  ReportsQueryDto,
  TcBookFileQueryDto,
  TcBookQueryDto,
} from './certificates.dto';

const dmy = (iso: string | null | undefined) =>
  iso ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : '';

/**
 * The certificate registers and reports (docs/design/87, phase E): the TC book register — every TC in the order of its
 * book and Sl. No. — and the reports: by type, by month, by issuer, issued past a check, and the requests' turnaround
 * and the public checks; each as Excel or PDF with the letterhead.
 */
@Injectable()
export class CertificateReportsService {
  constructor(private readonly db: DbService) {}

  async tcBook(ctx: RequestContext, q: TcBookQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const where: string[] = [`t.code = 'TC'`, 'x.copy_no = 0'];
      const params: unknown[] = [];
      const add = (sql: (n: string) => string, v: unknown) => {
        params.push(v);
        where.push(sql(`$${String(params.length)}`));
      };
      if (q.book) add((n) => `x.book_no = ${n}`, q.book);
      if (q.status) add((n) => `x.status = ${n}`, q.status);
      if (q.from) add((n) => `x.issued_on >= ${n}::date`, q.from);
      if (q.to) add((n) => `x.issued_on <= ${n}::date`, q.to);
      if (q.q)
        add(
          (n) => `(x.number ILIKE ${n} OR s.display_name ILIKE ${n} OR s.admission_no ILIKE ${n})`,
          `%${q.q}%`,
        );
      const w = where.join(' AND ');
      const from = `FROM certificates x JOIN certificate_types t ON t.id = x.type_id LEFT JOIN students s ON s.id = x.student_id`;
      const total = await c.query<{ n: number; books: number[] }>(
        // eslint-disable-next-line no-restricted-syntax -- from and the conditions are fixed fragments; values are bound parameters
        `SELECT count(*)::int AS n, COALESCE(array_agg(DISTINCT x.book_no) FILTER (WHERE x.book_no IS NOT NULL), '{}') AS books ${from} WHERE ${w}`,
        params,
      );
      const r = await c.query<{
        id: string;
        book_no: number | null;
        sl_no: number | null;
        number: string;
        issued_on: string;
        name: string | null;
        admission_no: string | null;
        last_class: string | null;
        reason: string | null;
        status: string;
        cancel_reason: string | null;
        copies: number;
      }>(
        // eslint-disable-next-line no-restricted-syntax -- from and the conditions are fixed fragments; values are bound parameters
        `SELECT x.id::text, x.book_no, x.sl_no, x.number, x.issued_on::text, s.display_name AS name, s.admission_no,
                COALESCE(x.data->'tc'->>'lastClass', x.data->'tc'->>'lastClass') AS last_class,
                COALESCE(x.data->'tc'->>'reason', '') AS reason, x.status, x.cancel_reason,
                (SELECT count(*)::int FROM certificates d WHERE d.original_id = x.id) AS copies
           ${from} WHERE ${w}
          ORDER BY x.book_no NULLS LAST, x.sl_no NULLS LAST, x.issued_on, x.id
          LIMIT $${String(params.length + 1)} OFFSET $${String(params.length + 2)}`,
        [...params, q.size, (q.page - 1) * q.size],
      );
      return {
        total: total.rows[0]?.n ?? 0,
        books: (total.rows[0]?.books ?? []).sort((a, b) => a - b),
        rows: r.rows.map((x) => ({
          id: x.id,
          bookNo: x.book_no,
          slNo: x.sl_no,
          number: x.number,
          issuedOn: x.issued_on,
          name: x.name,
          admissionNo: x.admission_no,
          lastClass: x.last_class,
          reason: x.reason,
          status: x.status,
          cancelReason: x.cancel_reason,
          copies: x.copies,
        })),
      };
    });
  }

  async tcBookFile(ctx: RequestContext, q: TcBookFileQueryDto) {
    const { rows } = await this.tcBook(ctx, { ...q, page: 1, size: 200 });
    let all = rows;
    for (let page = 2; all.length === (page - 1) * 200 && page <= 100; page++)
      all = all.concat((await this.tcBook(ctx, { ...q, page, size: 200 })).rows);
    const head = await this.db.tenant(requireTenant(ctx), (c) => schoolHead(c));
    return registerFile(
      {
        school: head.name,
        address: head.address,
        report: 'TC book register',
        details: [
          [
            q.book ? `Book ${String(q.book)}` : 'All books',
            q.from || q.to ? `${dmy(q.from) || '…'} to ${dmy(q.to) || '…'}` : null,
            q.status ? (q.status === 'issued' ? 'Issued' : 'Cancelled') : null,
            `${String(all.length)} TC(s)`,
          ]
            .filter(Boolean)
            .join(' · '),
          generatedOn(),
        ],
        legend:
          'Every TC in the order of its book and Sl. No. (100 to a book); a cancelled TC keeps its number.',
        columns: [
          { label: 'Book', width: 4, right: true },
          { label: 'Sl. no.', width: 4, right: true },
          { label: 'TC no.', width: 11 },
          { label: 'Issued on', width: 7 },
          { label: 'Admission no.', width: 7 },
          { label: 'Student', width: 14 },
          { label: 'Last class', width: 7 },
          { label: 'Reason', width: 14 },
          { label: 'Copies', width: 4, right: true },
          { label: 'Status', width: 10 },
        ],
        rows: all.map((x) => [
          x.bookNo ?? '',
          x.slNo ?? '',
          x.number,
          dmy(x.issuedOn),
          x.admissionNo ?? '',
          x.name ?? '',
          x.lastClass ?? '',
          x.reason ?? '',
          x.copies,
          x.status === 'issued'
            ? 'Issued'
            : `Cancelled${x.cancelReason ? `: ${x.cancelReason}` : ''}`,
        ]),
        filename: 'tc-book-register',
      },
      q.format,
    );
  }

  /** The reports of a period (the year so far when no dates are given). */
  async summary(ctx: RequestContext, q: ReportsQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const from =
        q.from ?? `${new Date().getFullYear() - (new Date().getMonth() < 3 ? 1 : 0)}-04-01`;
      const to = q.to ?? new Date().toISOString().slice(0, 10);
      const types = await c.query<{
        name: string;
        issued: number;
        duplicates: number;
        cancelled: number;
        overrides: number;
      }>(
        `SELECT t.name,
                count(*) FILTER (WHERE x.copy_no = 0)::int AS issued,
                count(*) FILTER (WHERE x.copy_no > 0)::int AS duplicates,
                count(*) FILTER (WHERE x.status = 'cancelled')::int AS cancelled,
                count(*) FILTER (WHERE x.override_reason IS NOT NULL)::int AS overrides
           FROM certificates x JOIN certificate_types t ON t.id = x.type_id
          WHERE x.issued_on BETWEEN $1::date AND $2::date
          GROUP BY t.name, t.sort_order ORDER BY t.sort_order, t.name`,
        [from, to],
      );
      const months = await c.query<{
        month: string;
        issued: number;
        duplicates: number;
        cancelled: number;
      }>(
        `SELECT to_char(date_trunc('month', x.issued_on), 'YYYY-MM') AS month,
                count(*) FILTER (WHERE x.copy_no = 0)::int AS issued,
                count(*) FILTER (WHERE x.copy_no > 0)::int AS duplicates,
                count(*) FILTER (WHERE x.status = 'cancelled')::int AS cancelled
           FROM certificates x WHERE x.issued_on BETWEEN $1::date AND $2::date
          GROUP BY 1 ORDER BY 1`,
        [from, to],
      );
      const issuers = await c.query<{ name: string; issued: number; overrides: number }>(
        `SELECT COALESCE(u.display_name, 'Not known') AS name, count(*)::int AS issued,
                count(*) FILTER (WHERE x.override_reason IS NOT NULL)::int AS overrides
           FROM certificates x LEFT JOIN users u ON u.id = x.issued_by
          WHERE x.issued_on BETWEEN $1::date AND $2::date
          GROUP BY 1 ORDER BY 2 DESC, 1`,
        [from, to],
      );
      const overrides = await c.query<{
        number: string;
        type: string;
        issued_on: string;
        name: string | null;
        reason: string;
        by: string | null;
      }>(
        `SELECT x.number, t.name AS type, x.issued_on::text, COALESCE(s.display_name, e.display_name) AS name,
                x.override_reason AS reason, u.display_name AS by
           FROM certificates x JOIN certificate_types t ON t.id = x.type_id
           LEFT JOIN students s ON s.id = x.student_id LEFT JOIN employees e ON e.id = x.employee_id
           LEFT JOIN users u ON u.id = x.override_by
          WHERE x.override_reason IS NOT NULL AND x.issued_on BETWEEN $1::date AND $2::date
          ORDER BY x.issued_on DESC LIMIT 500`,
        [from, to],
      );
      const requests = await c.query<{
        name: string;
        asked: number;
        issued: number;
        rejected: number;
        open: number;
        avg_days: string | null;
      }>(
        `SELECT t.name, count(*)::int AS asked,
                count(*) FILTER (WHERE r.status = 'issued')::int AS issued,
                count(*) FILTER (WHERE r.status = 'rejected')::int AS rejected,
                count(*) FILTER (WHERE r.status IN ('submitted', 'approved'))::int AS open,
                round(avg(EXTRACT(EPOCH FROM (r.issued_at - r.created_at)) / 86400) FILTER (WHERE r.status = 'issued')::numeric, 1)::text AS avg_days
           FROM certificate_requests r JOIN certificate_types t ON t.id = r.type_id
          WHERE r.created_at::date BETWEEN $1::date AND $2::date
          GROUP BY t.name, t.sort_order ORDER BY t.sort_order`,
        [from, to],
      );
      const checks = await c.query<{
        total: number;
        valid: number;
        cancelled: number;
        not_found: number;
      }>(
        `SELECT count(*)::int AS total, count(*) FILTER (WHERE result = 'valid')::int AS valid,
                count(*) FILTER (WHERE result = 'cancelled')::int AS cancelled,
                count(*) FILTER (WHERE result = 'not_found')::int AS not_found
           FROM certificate_verifications WHERE checked_at::date BETWEEN $1::date AND $2::date`,
        [from, to],
      );
      const t = types.rows;
      return {
        from,
        to,
        figures: {
          issued: t.reduce((n, x) => n + x.issued, 0),
          duplicates: t.reduce((n, x) => n + x.duplicates, 0),
          cancelled: t.reduce((n, x) => n + x.cancelled, 0),
          overrides: t.reduce((n, x) => n + x.overrides, 0),
          requests: requests.rows.reduce((n, x) => n + x.asked, 0),
          checks: checks.rows[0]?.total ?? 0,
        },
        types: t,
        months: months.rows,
        issuers: issuers.rows,
        overrides: overrides.rows.map((x) => ({ ...x, issuedOn: x.issued_on })),
        requests: requests.rows.map((x) => ({
          ...x,
          avgDays: x.avg_days ? Number(x.avg_days) : null,
        })),
        checks: checks.rows[0] ?? { total: 0, valid: 0, cancelled: 0, not_found: 0 },
      };
    });
  }

  async summaryFile(ctx: RequestContext, q: ReportsFileQueryDto) {
    const s = await this.summary(ctx, q);
    const head = await this.db.tenant(requireTenant(ctx), (c) => schoolHead(c));
    const base = {
      school: head.name,
      address: head.address,
      details: [`${dmy(s.from)} to ${dmy(s.to)}`, generatedOn()],
      legend: '',
    };
    const n = (v: number) => v;
    switch (q.kind) {
      case 'types':
        return registerFile(
          {
            ...base,
            report: 'Certificates by type',
            columns: [
              { label: 'Type', width: 18 },
              { label: 'Issued', width: 6, right: true },
              { label: 'Duplicates', width: 6, right: true },
              { label: 'Cancelled', width: 6, right: true },
              { label: 'Past a check', width: 6, right: true },
            ],
            rows: s.types.map((x) => [
              x.name,
              n(x.issued),
              n(x.duplicates),
              n(x.cancelled),
              n(x.overrides),
            ]),
            filename: 'certificates-by-type',
          },
          q.format,
        );
      case 'months':
        return registerFile(
          {
            ...base,
            report: 'Certificates by month',
            columns: [
              { label: 'Month', width: 8 },
              { label: 'Issued', width: 6, right: true },
              { label: 'Duplicates', width: 6, right: true },
              { label: 'Cancelled', width: 6, right: true },
            ],
            rows: s.months.map((x) => [x.month, x.issued, x.duplicates, x.cancelled]),
            filename: 'certificates-by-month',
          },
          q.format,
        );
      case 'issuers':
        return registerFile(
          {
            ...base,
            report: 'Certificates by who issued them',
            columns: [
              { label: 'Issued by', width: 18 },
              { label: 'Issued', width: 6, right: true },
              { label: 'Past a check', width: 6, right: true },
            ],
            rows: s.issuers.map((x) => [x.name, x.issued, x.overrides]),
            filename: 'certificates-by-issuer',
          },
          q.format,
        );
      case 'overrides':
        return registerFile(
          {
            ...base,
            report: 'Certificates issued past a failed check',
            columns: [
              { label: 'Number', width: 11 },
              { label: 'Type', width: 12 },
              { label: 'Issued on', width: 7 },
              { label: 'For', width: 12 },
              { label: 'Reason', width: 20 },
              { label: 'By', width: 10 },
            ],
            rows: s.overrides.map((x) => [
              x.number,
              x.type,
              dmy(x.issuedOn),
              x.name ?? '',
              x.reason,
              x.by ?? '',
            ]),
            filename: 'certificates-overrides',
          },
          q.format,
        );
      default:
        return registerFile(
          {
            ...base,
            report: 'Certificate requests',
            columns: [
              { label: 'Type', width: 18 },
              { label: 'Asked', width: 6, right: true },
              { label: 'Issued', width: 6, right: true },
              { label: 'Not approved', width: 6, right: true },
              { label: 'Open', width: 6, right: true },
              { label: 'Days to issue (avg)', width: 7, right: true },
            ],
            rows: s.requests.map((x) => [
              x.name,
              x.asked,
              x.issued,
              x.rejected,
              x.open,
              x.avgDays ?? '',
            ]),
            filename: 'certificate-requests',
          },
          q.format,
        );
    }
  }
}
