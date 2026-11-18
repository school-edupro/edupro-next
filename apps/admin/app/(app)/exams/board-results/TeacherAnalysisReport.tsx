import { Button, Card, SelectField } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { FileLinks } from '@/components/FileLinks';
import { apiFetch } from '@/lib/api';
import { yearLabel, type BoardTeacherAnalysis } from '@/lib/board-results';
import { GroupedTable } from './GroupedTable';

/** a teacher filter: a staff id, a name typed on the Teachers tab ("n:…"), or nobody set */
const TEACHER = /^(\d{1,18}|none|n:[^\n]{1,120})$/;

/**
 * Teacher wise result analysis (docs/design/88): the All subject result analysis a teacher — a row for each subject
 * and section taught (from the year's subject teachers or the Teachers tab's changes), the teacher's total, the PI
 * and the row's average against the subject's average over the whole class.
 */
export async function TeacherAnalysisReport({
  sp,
}: {
  sp: { classLabel?: string; examYear?: string; gender?: string; code?: string; teacher?: string };
}) {
  const b = await getTranslations('boardResults');
  const cls = sp.classLabel === 'XII' ? 'XII' : 'X';
  const f = new URLSearchParams({ classLabel: cls });
  if (/^\d{4}$/.test(sp.examYear ?? '')) f.set('examYear', sp.examYear!);
  if (sp.gender === 'M' || sp.gender === 'F') f.set('gender', sp.gender);
  if (/^\d{3}$/.test(sp.code ?? '')) f.set('code', sp.code!);
  if (TEACHER.test(sp.teacher ?? '')) f.set('teacher', sp.teacher!);
  const d = await apiFetch<BoardTeacherAnalysis>(
    `/exams/board-results/reports/teacher-analysis?${f.toString()}`,
  );
  const fileQ = new URLSearchParams(f);
  if (d.examYear) fileQ.set('examYear', String(d.examYear));
  const who = d.teacher ? d.teachers.find((t) => t.key === d.teacher)?.name : null;

  return (
    <>
      <Card title={b('rp_teachers')}>
        <p className="ep-field__help" style={{ marginTop: 0 }}>
          {b('rp_teachersHelp')}
        </p>
        <form
          method="get"
          action="/exams/board-results"
          style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap', alignItems: 'flex-end' }}
        >
          <input type="hidden" name="tab" value="reports" />
          <input type="hidden" name="report" value="teachers" />
          <SelectField
            id="ta-class"
            name="classLabel"
            label={b('an_class')}
            defaultValue={cls}
            options={[
              { value: 'X', label: 'Class X' },
              { value: 'XII', label: 'Class XII' },
            ]}
          />
          <SelectField
            id="ta-year"
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
            id="ta-teacher"
            name="teacher"
            label={b('rp_teacher')}
            defaultValue={d.teacher ?? ''}
            options={[
              { value: '', label: b('rp_allTeachers') },
              ...d.teachers.map((t) => ({
                value: t.key,
                label: t.key === 'none' ? b('rp_noTeacher') : t.name,
              })),
            ]}
          />
          <SelectField
            id="ta-code"
            name="code"
            label={b('rp_subject')}
            defaultValue={d.code ?? ''}
            options={[
              { value: '', label: b('rp_allSubjects') },
              ...d.subjects.map((s) => ({ value: s.code, label: `${s.code} - ${s.name}` })),
            ]}
          />
          <SelectField
            id="ta-gender"
            name="gender"
            label={b('rp_gender')}
            defaultValue={d.gender === 'all' ? '' : d.gender}
            options={[
              { value: '', label: b('rp_genderAll') },
              { value: 'M', label: b('rp_boys') },
              { value: 'F', label: b('rp_girls') },
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
          title={b('rp_teachersTitle')}
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
                href={`/exams/board-results/reports/teachers/pdf?${fileQ.toString()}`}
                label={b('rp_teachersTitle')}
              />
              <a
                className="ep-btn ep-btn--secondary ep-btn--sm"
                href={`/exams/board-results/reports/teachers/xlsx?${fileQ.toString()}`}
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
              who ?? b('rp_allTeachers'),
              d.gender === 'M'
                ? b('rp_boys')
                : d.gender === 'F'
                  ? b('rp_girls')
                  : b('rp_genderAll'),
            ]
              .filter(Boolean)
              .join(' · ')}{' '}
            <a
              href={`/exams/board-results?tab=teachers&classLabel=${cls}${d.examYear ? `&examYear=${String(d.examYear)}` : ''}`}
              style={{ textDecoration: 'underline' }}
            >
              {b('rp_teachersLink')}
            </a>
          </p>
          {d.table.rows.length ? (
            <GroupedTable t={d.table} label={b('rp_teachersTitle')} freeze={3} />
          ) : (
            <p style={{ margin: 0 }}>{b('rp_teachersNone')}</p>
          )}
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
