import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { objectKeyFor, type StorageDriver } from '@edupro/storage';
import {
  CANDIDATE_ACTIVITIES,
  CANDIDATE_DOCUMENTS,
  CANDIDATE_FIELDS,
  CANDIDATE_ROWS,
  CANDIDATE_SECTIONS,
  decryptField,
  type CandidateRowKind,
} from '@edupro/db';
import { STORAGE_DRIVER } from '../files/storage';
import { applicationPdf } from './application-pdf';
import { istText } from './recruitment.service';

type Snapshot = {
  values?: Record<string, unknown>;
  rows?: Partial<Record<CandidateRowKind, Array<Record<string, string | null>>>>;
  activities?: string[];
  files?: Array<{ id: string; kind: string; fileId: string; contentType: string }>;
};

const dmy = (d: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}` : d;

/**
 * The application PDF (docs/design/34-recruitment.md, part 7): made from the application as it was
 * submitted (its snapshot), with Aadhaar and PAN in full (the school's choice). Made when the
 * application is sent and attached to the "received" email; made again whenever the candidate or the
 * office downloads it (the snapshot does not change).
 */
@Injectable()
export class ApplicationPdfService {
  private readonly log = new Logger(ApplicationPdfService.name);

  constructor(@Inject(STORAGE_DRIVER) private readonly storage: StorageDriver) {}

  private async fileBytes(c: PoolClient, fileId: string | null | undefined) {
    if (!fileId || !/^\d{1,18}$/.test(fileId)) return null;
    const f = await c.query<{ object_key: string; content_type: string }>(
      `SELECT object_key, content_type FROM files WHERE id = $1 AND deleted_at IS NULL`,
      [fileId],
    );
    if (!f.rows[0]) return null;
    try {
      return {
        contentType: f.rows[0].content_type,
        bytes: await this.storage.read(f.rows[0].object_key),
      };
    } catch {
      return null;
    }
  }

  /** The PDF of one application of the school in context. */
  async render(c: PoolClient, applicationId: string) {
    const a = (
      await c.query<{
        number: string;
        submitted_at: Date;
        source: string;
        snapshot: Snapshot;
        secure: Record<string, string> | null;
        title: string;
        code: string;
        designation: string | null;
        department: string | null;
        subject: string | null;
        candidate: string | null;
      }>(
        `SELECT ja.number, ja.submitted_at, ja.source, ja.snapshot, ja.snapshot_secure AS secure, v.title, v.code,
                v.designation, v.department, v.subject, c.name AS candidate
           FROM job_applications ja JOIN vacancies v ON v.id = ja.vacancy_id JOIN candidates c ON c.id = ja.candidate_id
          WHERE ja.id = $1`,
        [applicationId],
      )
    ).rows[0];
    if (!a) return null;
    const s = (
      await c.query<{
        name: string;
        address: string | null;
        contact: string | null;
        logo: string | null;
      }>(
        `SELECT name,
                NULLIF(concat_ws(', ', NULLIF(btrim(address->>'line1'), ''), NULLIF(btrim(address->>'line2'), ''),
                       NULLIF(btrim(address->>'city'), ''), NULLIF(btrim(address->>'state'), ''),
                       NULLIF(btrim(COALESCE(address->>'pincode', address->>'pin')), '')), '') AS address,
                NULLIF(concat_ws(' · ', 'Phone ' || NULLIF(btrim(contact->>'phone'), ''), NULLIF(btrim(contact->>'email'), ''),
                       NULLIF(btrim(contact->>'website'), '')), '') AS contact,
                NULLIF(branding->>'logoFileId', '') AS logo
           FROM schools WHERE id = app.current_school_id()`,
      )
    ).rows[0]!;
    const snap = a.snapshot ?? {};
    const values = snap.values ?? {};
    const files = snap.files ?? [];
    const shown = (key: string, type: string): string => {
      const f = CANDIDATE_FIELDS.find((x) => x.key === key)!;
      let v: unknown = values[key];
      if (f.sensitive) {
        const enc = a.secure?.[key];
        try {
          v = enc ? decryptField(enc) : null;
        } catch {
          v = null;
        }
      }
      if (v === null || v === undefined || v === '') return '';
      const t = String(v);
      return type === 'date' ? dmy(t) : t;
    };
    const applies = (f: (typeof CANDIDATE_FIELDS)[number]) => {
      if (!f.when) return true;
      const v = String(values[f.when.key] ?? '');
      if (f.when.in) return f.when.in.includes(v);
      if (f.when.notIn) return !f.when.notIn.includes(v);
      return true;
    };
    const sections = CANDIDATE_SECTIONS.map((sec) => ({
      title: sec.title,
      rows: CANDIDATE_FIELDS.filter((f) => f.section === sec.id && applies(f))
        .map((f): [string, string] => [f.label, shown(f.key, f.type)])
        .filter(([, v]) => v !== ''),
    }));
    const lists = (Object.keys(CANDIDATE_ROWS) as CandidateRowKind[]).map((kind) => {
      const def = CANDIDATE_ROWS[kind];
      return {
        title: def.title,
        columns: def.columns.map((c) => c.label),
        rows: (snap.rows?.[kind] ?? []).map((r) =>
          def.columns.map((c) => {
            const v = r[c.key];
            return v ? (c.type === 'date' ? dmy(v) : v) : '';
          }),
        ),
      };
    });
    const photoFile = files.find((f) => f.kind === 'photo');
    const name =
      [values.first_name, values.last_name].filter(Boolean).join(' ') ||
      a.candidate ||
      'The candidate';
    const received = istText(a.submitted_at);
    const bytes = await applicationPdf({
      school: { name: s.name, address: s.address, contact: s.contact },
      logo: await this.fileBytes(c, s.logo),
      photo: photoFile ? await this.fileBytes(c, photoFile.fileId) : null,
      number: a.number,
      received,
      post: a.title,
      postLine:
        [a.designation, a.department, a.subject, `Vacancy ${a.code}`].filter(Boolean).join(' · ') ||
        null,
      sections,
      lists,
      interests: (snap.activities ?? []).filter((x) =>
        (CANDIDATE_ACTIVITIES as readonly string[]).includes(x),
      ),
      documents: CANDIDATE_DOCUMENTS.map((d): [string, string] => {
        const n = files.filter((f) => f.kind === d.kind).length;
        return [d.label, n ? (n > 1 ? `${String(n)} given` : 'Given') : 'Not given'];
      }),
      declaration:
        a.source === 'office'
          ? `Entered by the school office for ${name} on ${received}.`
          : `${name} declared that the details given are true, and that a false statement may end the candidature or employment. Sent online on ${received}.`,
    });
    return { filename: `Application-${a.number}.pdf`, bytes };
  }

  /**
   * The PDF made when the application is sent, kept as a file the "received" email carries. A PDF that
   * cannot be made leaves the email without it (logged), never the application unsent.
   */
  async store(c: PoolClient, applicationId: string) {
    await c.query('SAVEPOINT application_pdf');
    try {
      const out = await this.render(c, applicationId);
      if (!out) return null;
      const school = await c.query<{ id: string }>(`SELECT app.current_school_id()::text AS id`);
      const key = objectKeyFor(
        school.rows[0]!.id,
        'pdf',
        `application-${applicationId}-${randomBytes(6).toString('hex')}`,
      );
      await this.storage.write(key, out.bytes, 'application/pdf');
      const f = await c.query<{ id: string }>(
        `INSERT INTO files (school_id, bucket, object_key, content_type, size_bytes, sha256, original_name, owner_entity_type,
                            owner_entity_id, classification, storage_driver, status, scanned_at, scan_result, created_by, updated_by)
         VALUES (app.current_school_id(), $1, $2, 'application/pdf', $3, $4, $5, 'job_application', $6, 'sensitive', $7, 'ready',
                 now(), 'generated', app.current_user_id(), app.current_user_id())
         RETURNING id::text`,
        [
          this.storage.bucket,
          key,
          out.bytes.length,
          createHash('sha256').update(out.bytes).digest('hex'),
          out.filename,
          applicationId,
          this.storage.name,
        ],
      );
      const fileId = f.rows[0]!.id;
      await c.query(`UPDATE job_applications SET pdf_file_id = $2 WHERE id = $1`, [
        applicationId,
        fileId,
      ]);
      await c.query('RELEASE SAVEPOINT application_pdf');
      return { fileId, name: out.filename, contentType: 'application/pdf' };
    } catch (error) {
      await c.query('ROLLBACK TO SAVEPOINT application_pdf');
      this.log.warn(
        `application ${applicationId}: the PDF was not made (${(error as Error).message})`,
      );
      return null;
    }
  }
}
