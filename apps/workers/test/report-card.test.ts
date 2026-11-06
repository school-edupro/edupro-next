import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_SLIP_TEMPLATES, type JobEnvelope } from '@edupro/db';
import type { StorageDriver } from '@edupro/storage';
import { renderReportCard, renderReportCardBatch } from '../src/renderers/report-card';
import { newDb, seedSchool, stamp, withMigrator, type SeededSchool } from './helpers';

/**
 * Report-card PDFs (docs/design/65): a job carries no working year of its own, and the card reads the
 * year's enrolments; without the release's year every card failed "not enrolled in the working year"
 * (1 Nov 2026). Jobs queued before the API sent the year take it from the release.
 */
describe('report-card PDF jobs', () => {
  const db = newDb();
  let school: SeededSchool;
  const ids = { release: '', klass: '', a: '', b: '' };
  // no logo, photo or signature on file: nothing is read from storage
  const storage = {
    read: () => Promise.reject(new Error('no file')),
  } as unknown as StorageDriver;
  const envelope = (): JobEnvelope => ({
    schoolId: school.id,
    userId: school.userId,
    requestId: null,
    kind: 'export.generate',
    payload: {},
  });

  beforeAll(async () => {
    school = await seedSchool(stamp('RCJ'));
    await withMigrator(async (c) => {
      const k = await c.query<{ id: string }>(
        `INSERT INTO classes (school_id, code, name, display_order) VALUES ($1, 'VI', 'Class VI', 6) RETURNING id::text`,
        [school.id],
      );
      ids.klass = k.rows[0]!.id;
      const sec = await c.query<{ id: string }>(
        `INSERT INTO class_sections (school_id, academic_year_id, class_id, name, capacity) VALUES ($1, $2, $3, 'A', 40) RETURNING id::text`,
        [school.id, school.yearId, ids.klass],
      );
      for (const [i, first] of ['Asha', 'Bhanu'].entries()) {
        const st = await c.query<{ id: string }>(
          `INSERT INTO students (school_id, admission_no, first_name, last_name) VALUES ($1, $2, $3, 'Card') RETURNING id::text`,
          [school.id, `RC${String(i + 1)}`, first],
        );
        await c.query(
          `INSERT INTO enrolments (school_id, student_id, academic_year_id, class_section_id, roll_no, joined_on) VALUES ($1, $2, $3, $4, $5, CURRENT_DATE - 100)`,
          [school.id, st.rows[0]!.id, school.yearId, sec.rows[0]!.id, i + 1],
        );
        ids[i === 0 ? 'a' : 'b'] = st.rows[0]!.id;
      }
      const type = await c.query<{ id: string }>(
        `INSERT INTO exam_types (school_id, code, name) VALUES ($1, 'PT', 'Periodic test') RETURNING id::text`,
        [school.id],
      );
      const exam = await c.query<{ id: string }>(
        `INSERT INTO exams (school_id, academic_year_id, exam_type_id, code, name) VALUES ($1, $2, $3, 'PT1', 'Periodic Test 1') RETURNING id::text`,
        [school.id, school.yearId, type.rows[0]!.id],
      );
      await c.query(`INSERT INTO exam_classes (school_id, exam_id, class_id) VALUES ($1, $2, $3)`, [
        school.id,
        exam.rows[0]!.id,
        ids.klass,
      ]);
      const slip = TEST_SLIP_TEMPLATES.find((t) => t.band === 'middle')!;
      const tpl = await c.query<{ id: string }>(
        `INSERT INTO report_card_templates (school_id, code, name, band, layout) VALUES ($1, $2, $3, 'middle', $4::jsonb) RETURNING id::text`,
        [school.id, slip.code, slip.name, JSON.stringify(slip.layout)],
      );
      const rel = await c.query<{ id: string }>(
        `INSERT INTO report_card_releases (school_id, academic_year_id, kind, term_code, name, exam_ids, templates)
         VALUES ($1, $2, 'exam', 'PT1', 'Periodic Test 1', ARRAY[$3::bigint], $4::jsonb) RETURNING id::text`,
        [school.id, school.yearId, exam.rows[0]!.id, JSON.stringify({ middle: tpl.rows[0]!.id })],
      );
      ids.release = rel.rows[0]!.id;
    });
  });
  afterAll(async () => db.close());
  /** the export the card is recorded against */
  const exportFor = (dataset: string) =>
    withMigrator(async (c) => {
      const r = await c.query<{ id: string }>(
        `INSERT INTO exports (school_id, dataset, format, params, title, requested_by) VALUES ($1, $2, 'pdf', '{}'::jsonb, 'Report card', $3) RETURNING id::text`,
        [school.id, dataset, school.userId],
      );
      return r.rows[0]!.id;
    });

  it("prints one student's card for a job queued without the year (taken from the release)", async () => {
    const r = await renderReportCard(
      db,
      storage,
      envelope(),
      { releaseId: ids.release, studentId: ids.a },
      await exportFor('report_card'),
    );
    expect(r.html).toContain('Asha Card');
    // the VI-VIII test slip prints in the school's classic boxes since doc 74 ("Marks Obtained")
    expect(r.html).toContain('Marks Obtained');
  });

  it('prints the chosen students of a class in one PDF, with the year the API sends', async () => {
    const r = await renderReportCardBatch(
      db,
      storage,
      envelope(),
      {
        releaseId: ids.release,
        classId: ids.klass,
        studentIds: [ids.b, ids.a],
        academicYearId: school.yearId,
      },
      await exportFor('report_card_batch'),
    );
    expect(r.pupils).toBe(2);
    // in the order chosen on the Cards line
    expect(r.html.indexOf('Bhanu Card')).toBeLessThan(r.html.indexOf('Asha Card'));
  });
});
