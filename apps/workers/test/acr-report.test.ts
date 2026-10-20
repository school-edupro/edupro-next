import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { JobEnvelope } from '@edupro/db';
import type { StorageDriver } from '@edupro/storage';
import { renderAcrReport } from '../src/renderers/acr-report';
import { newDb, seedSchool, stamp, withMigrator, type SeededSchool } from './helpers';

/** The ACR printout (docs/design/32-employee-acr.md): self-appraisal, levels, result, steps, signatures. */
describe('ACR printout', () => {
  const db = newDb();
  let school: SeededSchool;
  let reportId = '';
  let otherId = '';
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
    school = await seedSchool(stamp('ACRP'));
    await withMigrator(async (c) => {
      await c.query(`SELECT app.acr_seed($1)`, [school.id]);
      await c.query(`SELECT app.acr_forms_from_questions($1)`, [school.id]);
      const year = await c.query<{ id: string }>(
        `SELECT id::text FROM academic_years WHERE school_id = $1 ORDER BY start_date DESC LIMIT 1`,
        [school.id],
      );
      const cy = await c.query<{ id: string }>(
        `INSERT INTO acr_cycles (school_id, academic_year_id, name, self_from, self_to, status)
         VALUES ($1, $2, 'ACR test', CURRENT_DATE - 1, CURRENT_DATE + 10, 'open') RETURNING id::text`,
        [school.id, year.rows[0]!.id],
      );
      const e = await c.query<{ id: string }>(
        `INSERT INTO employees (school_id, employee_code, first_name, designation, employee_type, profile)
         VALUES ($1, 'T9', 'Tara', 'TGT', 'teaching', '{"staff_type": "Teaching Regular"}'::jsonb),
                ($1, 'H9', 'Hema', 'HOD', 'teaching', '{}'::jsonb)
         RETURNING id::text`,
        [school.id],
      );
      const [tara, hema] = [e.rows[0]!.id, e.rows[1]!.id];
      const forms = await c.query<{ id: string; part: string }>(
        `SELECT id::text, part FROM acr_forms WHERE school_id = $1 AND staff_group = 'teaching' ORDER BY part`,
        [school.id],
      );
      const selfForm = forms.rows.find((f) => f.part === 'self')!.id;
      const levelForm = forms.rows.find((f) => f.part === 'level')!.id;
      const q = async (formId: string) =>
        (
          await c.query<{ id: string; kind: string }>(
            `SELECT id::text, kind FROM acr_questions WHERE form_id = $1 AND active ORDER BY sort_order, id`,
            [formId],
          )
        ).rows;
      const selfQ = await q(selfForm);
      const levelQ = await q(levelForm);
      const firstScale = (xs: Array<{ id: string; kind: string }>) =>
        xs.find((x) => x.kind === 'scale')!.id;
      const firstText = (xs: Array<{ id: string; kind: string }>) =>
        xs.find((x) => x.kind === 'text')?.id;
      const selfAnswers: Record<string, unknown> = { [firstScale(selfQ)]: 4 };
      const st = firstText(selfQ);
      if (st) selfAnswers[st] = 'Took the <science> club';
      const r = await c.query<{ id: string }>(
        `INSERT INTO acr_reports (school_id, cycle_id, employee_id, staff_group, self_form_id, status, current_level,
                                  self_answers, self_pct, self_submitted_at)
         VALUES ($1, $2, $3, 'teaching', $4, 'review', 2, $5::jsonb, 80, now()) RETURNING id::text`,
        [school.id, cy.rows[0]!.id, tara, selfForm, JSON.stringify(selfAnswers)],
      );
      reportId = r.rows[0]!.id;
      await c.query(
        `INSERT INTO acr_reviews (school_id, report_id, seq, label, action, reviewer_ids, form_id, status, answers,
                                  remarks, score_pct, grade, filled_by_name, filled_at)
         VALUES ($1, $2, 1, 'HOD', 'rate', ARRAY[$3]::bigint[], $4, 'done', $5::jsonb, 'Steady <work>', 75, 'Good', 'Hema', now()),
                ($1, $2, 2, 'Principal', 'review', ARRAY[$3]::bigint[], NULL, 'pending', '{}'::jsonb, NULL, NULL, NULL, NULL, NULL)`,
        [school.id, reportId, hema, levelForm, JSON.stringify({ [firstScale(levelQ)]: 3 })],
      );
      await c.query(
        `INSERT INTO acr_events (school_id, report_id, what, note, by_name) VALUES ($1, $2, 'started', NULL, 'Office')`,
        [school.id, reportId],
      );
      const o = await c.query<{ id: string }>(
        `INSERT INTO acr_reports (school_id, cycle_id, employee_id, staff_group, self_form_id, status)
         VALUES ($1, $2, $3, 'teaching', $4, 'self') RETURNING id::text`,
        [school.id, cy.rows[0]!.id, hema, selfForm],
      );
      otherId = o.rows[0]!.id;
    });
  });
  afterAll(async () => db.close());

  it('prints the self-appraisal with its answers, each level with its answers, grade and remarks, the steps and the signature lines', async () => {
    const r = await renderAcrReport(db, storage, envelope(), { reportIds: reportId });
    expect(r).toMatchObject({ width: '210mm', height: '297mm', count: 1 });
    const html = r.html;
    expect(html).toContain('Annual Confidential Report');
    expect(html).toContain('Tara');
    expect(html).toContain('T9');
    expect(html).toContain('Teaching Regular');
    expect(html).toContain('Part A · Self-appraisal');
    // a rating on the scale, and the written answer escaped
    expect(html).toContain('4 · Very good');
    expect(html).toContain('Took the &lt;science&gt; club');
    expect(html).toContain('Self score');
    expect(html).toContain('80%');
    // the HOD's level: filled, with its rating, grade and remarks; the Principal's: with them now
    expect(html).toContain('1. HOD · rates');
    expect(html).toContain('Hema (H9)');
    expect(html).toContain('3 · Good');
    expect(html).toContain('Steady &lt;work&gt;');
    expect(html).toContain('<b>Good</b>');
    expect(html).toContain('2. Principal · reviews');
    expect(html).toContain('With them now');
    expect(html).toContain('ACR started');
    // the signature lines: the employee (signed on submission), the HOD who filled (by their login),
    // the Principal's people still to sign; no signature image on file, so the names only
    expect(html).toContain('Tara (T9) · TGT');
    expect(html).toContain('<div class="line">Employee</div>');
    expect(html).toContain('<div class="line">HOD</div>');
    expect(html).toContain('<div class="line">Principal</div>');
    expect(html).toContain('Hema (H9)');
    expect(html).not.toContain('<img src="data:');
    expect(html).not.toContain('class="acr brk"');
  });

  it('many ACRs: a page break between them; an unknown id fails the job', async () => {
    const r = await renderAcrReport(db, storage, envelope(), {
      reportIds: `${reportId},${otherId}`,
    });
    expect(r.count).toBe(2);
    expect(r.html).toContain('class="acr brk"');
    expect(r.html).toContain('Not yet');
    await expect(
      renderAcrReport(db, storage, envelope(), { reportIds: '999999999' }),
    ).rejects.toThrow('not found');
  });
});
