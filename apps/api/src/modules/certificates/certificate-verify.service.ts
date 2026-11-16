import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import QRCode from 'qrcode';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { ENV, type Env } from '../../config/env';
import { publicTenant } from '../admissions/public/otp.service';

/**
 * The public check of a certificate (docs/design/87, phase D). Every certificate prints a QR of its own link,
 * <public site>/<school code>/verify/<token>; opening it — or searching a number with its date of issue on the school's
 * check page — shows Valid, Cancelled or a duplicate of an original, the type, number and date, the school and the
 * holder's name masked ("A***v S****a"). No sign-in; rate-limited per address; every check is logged with a hash of
 * the address, never the address itself.
 */
export type VerifyResult = 'valid' | 'cancelled' | 'not_found';

/** "Aarav Sharma" → "A***v S****a": enough to match the paper in hand, not to learn a name. */
export function maskName(name: string | null | undefined): string {
  return String(name ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) =>
      w.length <= 2 ? `${w[0]!}*` : `${w[0]!}${'*'.repeat(w.length - 2)}${w[w.length - 1]!}`,
    )
    .join(' ');
}

@Injectable()
export class CertificateVerifyService {
  constructor(
    private readonly db: DbService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** The link and QR of a certificate (frozen in its data at issue; the PDF prints them). */
  async qrFor(c: PoolClient, token: string): Promise<{ url: string; image: string }> {
    const code = (
      await c.query<{ code: string }>(
        `SELECT lower(code) AS code FROM schools WHERE id = app.current_school_id()`,
      )
    ).rows[0]!.code;
    const url = `${this.env.PUBLIC_APP_URL.replace(/\/$/, '')}/${code}/verify/${token}`;
    const image = await QRCode.toString(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' });
    return { url, image };
  }

  /** The school's check page (for the preview, before a certificate has its own link). */
  async samplePageQr(c: PoolClient): Promise<{ url: string; image: string }> {
    const code = (
      await c.query<{ code: string }>(
        `SELECT lower(code) AS code FROM schools WHERE id = app.current_school_id()`,
      )
    ).rows[0]!.code;
    const url = `${this.env.PUBLIC_APP_URL.replace(/\/$/, '')}/${code}/verify`;
    const image = await QRCode.toString(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' });
    return { url: `${url}/… (the certificate's own link, made on issue)`, image };
  }

  /** Writes the QR into a certificate's data (on issue, on a duplicate, and for one made before phase D). */
  async stamp(c: PoolClient, certificateId: string): Promise<void> {
    const r = (
      await c.query<{ token: string; has: boolean }>(
        `SELECT verify_token AS token, (data ? 'qr') AS has FROM certificates WHERE id = $1`,
        [certificateId],
      )
    ).rows[0];
    if (!r || r.has) return;
    const qr = await this.qrFor(c, r.token);
    await c.query(
      `UPDATE certificates SET data = jsonb_set(data, '{qr}', $2::jsonb) WHERE id = $1`,
      [certificateId, JSON.stringify(qr)],
    );
  }

  private async school(code: string) {
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(code)) throw new DomainError('not-found', 'School not found');
    const id = await this.db.global(async (c) => {
      const r = await c.query<{ id: string | null }>(
        `SELECT app.public_school_id($1)::text AS id`,
        [code],
      );
      return r.rows[0]?.id ?? null;
    });
    if (!id) throw new DomainError('not-found', 'School not found');
    return publicTenant(id);
  }

  private async answer(
    c: PoolClient,
    who: { ip: string; agent: string | undefined },
    found: string | null,
    method: 'qr' | 'search',
    tried: string | null,
  ) {
    const school = (
      await c.query<{ name: string; code: string; address: unknown }>(
        `SELECT name, lower(code) AS code, address FROM schools WHERE id = app.current_school_id()`,
      )
    ).rows[0]!;
    const x = found
      ? (
          await c.query<{
            id: string;
            type_name: string;
            number: string;
            copy_no: number;
            issued_on: string;
            status: string;
            cancelled_at: Date | null;
            student: string | null;
            employee: string | null;
            legacy: boolean;
            copies: number;
            revision: number;
            revised_at: Date | null;
          }>(
            `SELECT x.id::text, t.name AS type_name, x.number, x.copy_no, x.issued_on::text, x.status, x.cancelled_at,
                    COALESCE(o.revision, x.revision) AS revision, COALESCE(o.revised_at, x.revised_at) AS revised_at,
                    COALESCE(x.data->'student'->>'name', s.display_name) AS student,
                    COALESCE(x.data->'employee'->>'name', e.display_name) AS employee, x.legacy,
                    (SELECT count(*)::int FROM certificates d WHERE d.original_id = COALESCE(x.original_id, x.id)) AS copies
               FROM certificates x JOIN certificate_types t ON t.id = x.type_id
               LEFT JOIN certificates o ON o.id = x.original_id
               LEFT JOIN students s ON s.id = x.student_id LEFT JOIN employees e ON e.id = x.employee_id
              WHERE x.id = $1`,
            [found],
          )
        ).rows[0]
      : undefined;
    const result: VerifyResult = !x ? 'not_found' : x.status === 'issued' ? 'valid' : 'cancelled';
    await c.query(
      `INSERT INTO certificate_verifications (school_id, certificate_id, method, result, number_tried, ip_hash, user_agent)
       VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6)`,
      [
        x?.id ?? null,
        method,
        result,
        tried?.slice(0, 60) ?? null,
        createHash('sha256').update(`${who.ip}|${school.code}`).digest('hex').slice(0, 32),
        (who.agent ?? '').slice(0, 160) || null,
      ],
    );
    return {
      result,
      school: { name: school.name, code: school.code },
      certificate: x
        ? {
            type: x.type_name,
            number: x.number,
            copy: x.copy_no,
            issuedOn: x.issued_on,
            holder: maskName(x.student ?? x.employee),
            holderKind: x.student ? 'student' : 'staff',
            cancelledOn: x.cancelled_at ? x.cancelled_at.toISOString().slice(0, 10) : null,
            duplicates: x.copies,
            legacy: x.legacy,
            revision: x.revision,
            correctedOn:
              x.revision > 1 && x.revised_at ? x.revised_at.toISOString().slice(0, 10) : null,
          }
        : null,
      checkedAt: new Date().toISOString(),
    };
  }

  /** The check behind a certificate's QR. */
  async byToken(schoolCode: string, token: string, who: { ip: string; agent: string | undefined }) {
    const tenant = await this.school(schoolCode);
    return this.db.tenant(tenant, async (c) => {
      const id = /^[0-9a-f]{20,64}$/.test(token)
        ? ((
            await c.query<{ id: string }>(
              `SELECT id::text FROM certificates WHERE verify_token = $1`,
              [token],
            )
          ).rows[0]?.id ?? null)
        : null;
      return this.answer(c, who, id, 'qr', null);
    });
  }

  /** The check by the number on the paper and its date of issue (both must match). */
  async bySearch(
    schoolCode: string,
    number: string,
    issuedOn: string,
    who: { ip: string; agent: string | undefined },
  ) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(issuedOn) || Number.isNaN(Date.parse(issuedOn)))
      throw new DomainError(
        'validation-failed',
        'The date of issue as on the certificate (dd-mm-yyyy)',
        {
          status: 400,
        },
      );
    if (number.trim().length < 3 || number.length > 60)
      throw new DomainError('validation-failed', 'The number as printed on the certificate', {
        status: 400,
      });
    const tenant = await this.school(schoolCode);
    return this.db.tenant(tenant, async (c) => {
      const id =
        (
          await c.query<{ id: string }>(
            `SELECT x.id::text FROM certificates x WHERE upper(x.number) = upper($1) AND x.copy_no = 0
                AND (x.issued_on = $2::date
                     OR EXISTS (SELECT 1 FROM certificate_revisions r WHERE r.certificate_id = x.id AND r.issued_on = $2::date))`,
            [number.trim(), issuedOn],
          )
        ).rows[0]?.id ?? null;
      return this.answer(c, who, id, 'search', number);
    });
  }

  /** The school's name for its check page. */
  async page(schoolCode: string) {
    const tenant = await this.school(schoolCode);
    return this.db.tenant(tenant, async (c) => {
      const s = (
        await c.query<{ name: string }>(
          `SELECT name FROM schools WHERE id = app.current_school_id()`,
        )
      ).rows[0]!;
      return { school: s.name };
    });
  }

  /** The checks of one certificate (its page in the admin app). */
  async ofCertificate(ctx: RequestContext, certificateId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{
        checked_at: Date;
        method: string;
        result: string;
        repeat: boolean;
      }>(
        `SELECT checked_at, method, result,
                count(*) OVER (PARTITION BY ip_hash) > 1 AS repeat
           FROM certificate_verifications WHERE certificate_id = $1 ORDER BY checked_at DESC LIMIT 200`,
        [certificateId],
      );
      return {
        total: r.rows.length,
        rows: r.rows.map((x) => ({
          at: x.checked_at.toISOString(),
          method: x.method,
          result: x.result,
          repeat: x.repeat,
        })),
      };
    });
  }
}
