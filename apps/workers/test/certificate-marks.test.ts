import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { JobEnvelope } from '@edupro/db';
import type { StorageDriver } from '@edupro/storage';
import { renderCertificate, renderCertificateBatch } from '../src/renderers/certificate';
import { renderCertificateBatchDoc } from '../src/renderers/certificate-batch-doc';
import { renderCertificateDoc } from '../src/renderers/certificate-doc';
import { renderDocument } from '../src/renderers/document';
import { newDb, seedSchool, stamp, withMigrator, type SeededSchool } from './helpers';

/**
 * A cancelled certificate never prints clean (17 Nov 2026): every renderer that prints one — the register's, a batch
 * PDF, a certificate from the achievement module, an old TC from its template — puts CANCELLED across it, with the
 * day; an issued one prints without a word.
 */
describe('certificate marks', () => {
  const db = newDb();
  let school: SeededSchool;
  const ids = {
    issued: '',
    cancelled: '',
    batch: '',
    achIssued: '',
    achCancelled: '',
    achExport: '',
    achTemplate: '',
    tc: '',
    tcTemplate: '',
  };
  const storage = {
    read: () => Promise.reject(new Error('no file')),
  } as unknown as StorageDriver;
  const envelope = (): JobEnvelope => ({
    schoolId: school.id,
    userId: null,
    requestId: null,
    kind: 'export.generate',
    payload: {},
  });

  beforeAll(async () => {
    school = await seedSchool(stamp('CMRK'));
    await withMigrator(async (c) => {
      const st = await c.query<{ id: string }>(
        `INSERT INTO students (school_id, admission_no, first_name, last_name, gender, status)
         VALUES ($1, 'CM-1', 'Asha', 'Mark', 'female', 'active'),
                ($1, 'CM-2', 'Ravi', 'Mark', 'male', 'active')
         RETURNING id::text`,
        [school.id],
      );
      const [asha, ravi] = [st.rows[0]!.id, st.rows[1]!.id];
      const tpl = await c.query<{ id: string }>(
        `INSERT INTO document_templates (school_id, code, name, kind, page_width, page_height, body_html, styles_css)
         VALUES ($1, 'cert_mark_test', 'Mark test', 'certificate', '210mm', '297mm',
                 '<div class="cert">{{{blocks.duplicate}}}<p>{{cert.number}}</p></div>', '.cert { color: black; }')
         RETURNING id::text`,
        [school.id],
      );
      const version = await c.query<{ id: string }>(
        `SELECT id::text FROM document_template_versions WHERE template_id = $1 ORDER BY version DESC LIMIT 1`,
        [tpl.rows[0]!.id],
      );
      const type = await c.query<{ id: string }>(
        `INSERT INTO certificate_types (school_id, code, name, audience, prefix)
         VALUES ($1, 'MARKT', 'Mark test', 'STUDENT', 'MRK') RETURNING id::text`,
        [school.id],
      );
      const certs = await c.query<{ id: string }>(
        `INSERT INTO certificates (school_id, type_id, number, student_id, status, data, template_version_id,
                                   cancelled_at, cancel_reason)
         VALUES ($1, $2, 'MRK/2026-27/00001', $3, 'issued', '{"cert": {"number": "MRK/2026-27/00001"}}', $5, NULL, NULL),
                ($1, $2, 'MRK/2026-27/00002', $4, 'cancelled', '{"cert": {"number": "MRK/2026-27/00002"}}', $5,
                 '2026-11-17 10:00+05:30', 'Issued in error')
         RETURNING id::text`,
        [school.id, type.rows[0]!.id, asha, ravi, version.rows[0]!.id],
      );
      ids.issued = certs.rows[0]!.id;
      ids.cancelled = certs.rows[1]!.id;
      const b = await c.query<{ id: string }>(
        `INSERT INTO certificate_batches (school_id, type_id, title, certificate_ids)
         VALUES ($1, $2, 'Mark test batch', ARRAY[$3, $4]::bigint[]) RETURNING id::text`,
        [school.id, type.rows[0]!.id, ids.issued, ids.cancelled],
      );
      ids.batch = b.rows[0]!.id;

      // the achievement module's certificates, moved into the register (one of them cancelled there)
      const at = await c.query<{ id: string }>(
        `INSERT INTO document_templates (school_id, code, name, kind, page_width, page_height, body_html, styles_css)
         VALUES ($1, 'ach_mark_test', 'Achievement mark test', 'certificate', '297mm', '210mm',
                 '<h1>{{certificate.title}} {{certificate.serialNo}}</h1>', '')
         RETURNING id::text`,
        [school.id],
      );
      ids.achTemplate = at.rows[0]!.id;
      const ex = await c.query<{ id: string }>(
        `INSERT INTO exports (school_id, dataset, format, params, title)
         VALUES ($1, 'certificate_batch', 'pdf', jsonb_build_object('templateId', $2::text), 'Achievement batch')
         RETURNING id::text`,
        [school.id, ids.achTemplate],
      );
      ids.achExport = ex.rows[0]!.id;
      const ach = await c.query<{ id: string }>(
        `INSERT INTO certificates_issued (school_id, student_id, template_id, serial_no, title, export_id)
         VALUES ($1, $2, $4, 'ACH-1', 'Sports day', $5), ($1, $3, $4, 'ACH-2', 'Sports day', $5)
         RETURNING id::text`,
        [school.id, asha, ravi, ids.achTemplate, ids.achExport],
      );
      ids.achIssued = ach.rows[0]!.id;
      ids.achCancelled = ach.rows[1]!.id;
      await c.query(
        `INSERT INTO certificates (school_id, type_id, number, student_id, status, legacy, legacy_ref, cancelled_at, cancel_reason)
         VALUES ($1, $2, 'ACH-1', $3, 'issued', true, 'achievement:' || $5::text, NULL, NULL),
                ($1, $2, 'ACH-2', $4, 'cancelled', true, 'achievement:' || $6::text, '2026-11-16 10:00+05:30', 'Wrong event')`,
        [school.id, type.rows[0]!.id, asha, ravi, ids.achIssued, ids.achCancelled],
      );

      // an old TC printed from its template, cancelled
      const tt = await c.query<{ id: string }>(
        `INSERT INTO document_templates (school_id, code, name, kind, page_width, page_height, body_html, styles_css)
         VALUES ($1, 'tc_mark_test', 'TC mark test', 'transfer_certificate', '210mm', '297mm', '<p>TC</p>', '')
         RETURNING id::text`,
        [school.id],
      );
      ids.tcTemplate = tt.rows[0]!.id;
      const tc = await c.query<{ id: string }>(
        `INSERT INTO transfer_certificates (school_id, student_id, academic_year_id, tc_no, serial, reason, template_id,
                                            status, cancelled_at, cancel_reason)
         VALUES ($1, $2, $3, 'TC/2026-27/0099', 99, 'Moving', $4, 'cancelled', '2026-11-15 10:00+05:30', 'Issued in error')
         RETURNING id::text`,
        [school.id, ravi, school.yearId, ids.tcTemplate],
      );
      ids.tc = tc.rows[0]!.id;
    });
  });

  afterAll(async () => {
    await db.close();
  });

  const marks = (html: string) => [...html.matchAll(/data-mark="([^"]+)"/g)].map((m) => m[1]);

  it('the register prints CANCELLED, with the day, only on a cancelled certificate', async () => {
    const clean = await renderCertificateDoc(db, storage, envelope(), {
      certificateId: ids.issued,
    });
    expect(marks(clean.html)).toEqual([]);
    const cancelled = await renderCertificateDoc(db, storage, envelope(), {
      certificateId: ids.cancelled,
    });
    expect(marks(cancelled.html)).toEqual(['CANCELLED']);
    expect(cancelled.html).toContain('Cancelled on 17-11-2026');
    // the word's CSS comes after the template's, so a layout cannot hide it
    expect(cancelled.html.indexOf('.eb-mark {')).toBeGreaterThan(
      cancelled.html.indexOf('.cert { color: black; }'),
    );
  });

  it("a batch PDF marks the cancelled certificate's own page", async () => {
    const doc = await renderCertificateBatchDoc(db, storage, envelope(), { batchId: ids.batch });
    expect(doc.count).toBe(2);
    const pages = doc.html.split('<div class="eb-page eb-mark-host">').slice(1);
    expect(pages).toHaveLength(2);
    expect(marks(pages[0]!)).toEqual([]);
    expect(marks(pages[1]!)).toEqual(['CANCELLED']);
  });

  it('a certificate from the achievement module cancelled in the register prints CANCELLED', async () => {
    const one = await renderCertificate(db, envelope(), { certificateId: ids.achCancelled });
    expect(marks(one.html)).toEqual(['CANCELLED']);
    expect(one.html).toContain('Cancelled on 16-11-2026');
    const fine = await renderCertificate(db, envelope(), { certificateId: ids.achIssued });
    expect(marks(fine.html)).toEqual([]);
    const batch = await renderCertificateBatch(
      db,
      envelope(),
      { templateId: ids.achTemplate },
      ids.achExport,
    );
    expect(batch.count).toBe(2);
    expect(marks(batch.html)).toEqual(['CANCELLED']);
    expect(batch.html.indexOf('data-mark')).toBeGreaterThan(batch.html.indexOf('ACH-1'));
  });

  it('an old TC printed from its template prints CANCELLED once cancelled', async () => {
    const doc = await renderDocument(db, envelope(), {
      templateId: ids.tcTemplate,
      entity: 'transfer_certificate',
      entityId: ids.tc,
    });
    expect(marks(doc.html)).toEqual(['CANCELLED']);
    expect(doc.html).toContain('Cancelled on 15-11-2026');
  });
});
