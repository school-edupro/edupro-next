import { Button, Card, SelectField } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { FileLinks } from '@/components/FileLinks';
import { apiFetch } from '@/lib/api';
import { yearLabel, type BoardSubjectPerf } from '@/lib/board-results';
import { GroupedTable } from './GroupedTable';

/**
 * Subject Summary (docs/design/88), the school's old "All Subject Performance Report (percentage-based, not
 * grade-based)": a row a subject with boys and girls — appeared, failures, compartments, pass, the averages, the
 * highest — and boys and girls in each marks range A1 (91–100) … E1 (0–32); a total line.
 */
export async function SubjectPerfReport({
  sp,
}: {
  sp: { classLabel?: string; examYear?: string; gender?: string; code?: string; section?: string };
}) {
  const b = await getTranslations('boardResults');
  const cls = sp.classLabel === 'XII' ? 'XII' : 'X';
  const f = new URLSearchParams({ classLabel: cls });
  if (/^\d{4}$/.test(sp.examYear ?? '')) f.set('examYear', sp.examYear!);
  if (sp.gender === 'M' || sp.gender === 'F') f.set('gender', sp.gender);
  if (/^\d{3}$/.test(sp.code ?? '')) f.set('code', sp.code!);
  // "each": a row for each section under every subject; else one section, or all together
  if (sp.section && sp.section.length <= 40 && !/[\n\r]/.test(sp.section))
    f.set('section', sp.section);
  const d = await apiFetch<BoardSubjectPerf>(
    `/exams/board-results/reports/subject-summary?${f.toString()}`,
  );
  const fileQ = new URLSearchParams(f);
  if (d.examYear) fileQ.set('examYear', String(d.examYear));

  return (
    <>
      <Card title={b('rp_subjects')}>
        <p className="ep-field__help" style={{ marginTop: 0 }}>
          {b('rp_subjectsHelp')}
        </p>
        <form
          method="get"
          action="/exams/board-results"
          style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap', alignItems: 'flex-end' }}
        >
          <input type="hidden" name="tab" value="reports" />
          <input type="hidden" name="report" value="subjects" />
          <SelectField
            id="sb-class"
            name="classLabel"
            label={b('an_class')}
            defaultValue={cls}
            options={[
              { value: 'X', label: 'Class X' },
              { value: 'XII', label: 'Class XII' },
            ]}
          />
          <SelectField
            id="sb-year"
            name="examYear"
            label={b('an_year')}
            defaultValue={d.examYear ? String(d.examYear) : ''}
            options={
              d.years.length
                ? d.years.map((y) => ({
                    value: String(y),
                    label: `${String(y)} (${yearLabel(y)})`,
                  }))
                : [{ value: '', label: '—' }]
            }
          />
          <SelectField
            id="sb-gender"
            name="gender"
            label={b('rp_gender')}
            defaultValue={d.gender === 'all' ? '' : d.gender}
            options={[
              { value: '', label: b('rp_genderAll') },
              { value: 'M', label: b('rp_boys') },
              { value: 'F', label: b('rp_girls') },
            ]}
          />
          <SelectField
            id="sb-section"
            name="section"
            label={b('an_section')}
            defaultValue={d.section ?? ''}
            options={[
              { value: '', label: b('rp_sectionsTogether') },
              { value: 'each', label: b('rp_sectionsEach') },
              ...d.sections.map((x) => ({ value: x, label: b('rp_sectionOnly', { s: x }) })),
            ]}
          />
          <SelectField
            id="sb-code"
            name="code"
            label={b('rp_subject')}
            defaultValue={d.code ?? ''}
            options={[
              { value: '', label: b('rp_allSubjects') },
              ...d.subjects.map((s) => ({ value: s.code, label: `${s.code} - ${s.name}` })),
            ]}
          />
          <Button type="submit" size="sm">
            {b('an_show')}
          </Button>
        </form>
      </Card>

      {!d.table ? (
        <Card title={b('an_noneTitle')}>
          <p style={{ margin: 0 }}>
            {b('an_none', { cls })}{' '}
            <a href="/exams/board-results?tab=upload" style={{ textDecoration: 'underline' }}>
              {b('tab_upload')}
            </a>
          </p>
        </Card>
      ) : (
        <Card
          title={b('rp_subjectsTitle')}
          actions={
            <span
              style={{
                display: 'inline-flex',
                gap: 'var(--sp-3)',
                alignItems: 'center',
                flexWrap: 'wrap',
              }}
            >
              <span className="ep-field__help">PDF</span>
              <FileLinks
                href={`/exams/board-results/reports/subjects/pdf?${fileQ.toString()}`}
                label={b('rp_subjects')}
              />
              <a
                className="ep-btn ep-btn--secondary ep-btn--sm"
                href={`/exams/board-results/reports/subjects/xlsx?${fileQ.toString()}`}
              >
                {b('rs_excel')}
              </a>
            </span>
          }
        >
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            {[
              `Class ${cls}`,
              d.examYear ? `${String(d.examYear)} (${yearLabel(d.examYear)})` : '',
              d.gender === 'M'
                ? b('rp_boys')
                : d.gender === 'F'
                  ? b('rp_girls')
                  : b('rp_genderAll'),
              d.section === 'each'
                ? b('rp_sectionsEach')
                : d.section
                  ? b('rp_sectionOnly', { s: d.section })
                  : b('rp_sectionsTogether'),
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <GroupedTable t={d.table} label={b('rp_subjects')} freeze={2} />
          {d.table.note ? (
            <p className="ep-field__help" style={{ marginBottom: 0 }}>
              {d.table.note}
            </p>
          ) : null}
        </Card>
      )}
    </>
  );
}
