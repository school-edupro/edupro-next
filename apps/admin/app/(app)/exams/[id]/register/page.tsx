import { Badge, Breadcrumbs, Button, Card, PageHeader, SelectField } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { computeExamResults } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import { sectionOptions } from '@/lib/sections';
import type { Exam, RegisterSheet } from '@/lib/types';

/** Sprint 16: the mark register of one section (pupils × subjects with totals, grade and rank). */
export default async function RegisterPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ section?: string; ok?: string; error?: string; detail?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const [t, r, me, exam, sections] = await Promise.all([
    getTranslations('pages.exams_register'),
    getTranslations('results'),
    getMe(),
    apiFetch<Exam>(`/exams/${id}`),
    sectionOptions(),
  ]);
  // sections of the classes in the exam only (labels are `${classCode}-${section}`)
  const classCodes = new Set(exam.classes.map((c) => c.classCode));
  const options = sections.filter((s) =>
    classCodes.has(s.label.slice(0, s.label.lastIndexOf('-'))),
  );
  const sectionId = sp.section ?? options[0]?.value;
  const sheet = sectionId
    ? await apiFetch<RegisterSheet>(
        `/exams/${id}/register-sheet?classSectionId=${sectionId}`,
      ).catch(() => null)
    : null;
  const canManage = me.permissions.includes('exams.master.manage');
  return (
    <>
      <Breadcrumbs
        items={[
          { label: t('kicker'), href: '/exams' },
          { label: exam.name, href: `/exams/${id}` },
          { label: t('title') },
        ]}
      />
      <PageHeader
        kicker={t('kicker')}
        title={`${t('title')} · ${exam.name}`}
        description={
          sheet?.exam.computedAt
            ? r('computedAt', { at: sheet.exam.computedAt.slice(0, 16).replace('T', ' ') })
            : r('notComputed')
        }
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)' }}>
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href={`/exams/${id}/analysis`}>
              {r('analysis')}
            </a>
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href={`/exams/${id}/promotion`}>
              {r('promotion')}
            </a>
            {canManage ? (
              <form action={computeExamResults}>
                <input type="hidden" name="examId" value={id} />
                <input
                  type="hidden"
                  name="back"
                  value={`/exams/${id}/register?section=${sectionId ?? ''}`}
                />
                <Button type="submit" size="sm">
                  {r('compute')}
                </Button>
              </form>
            ) : null}
          </span>
        }
      />
      <Notice params={sp} />
      <Card
        title={sheet ? `${r('register')} · ${sheet.section.code}` : r('register')}
        actions={
          <form
            method="get"
            style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'flex-end' }}
          >
            <SelectField
              id="section"
              name="section"
              label={r('section')}
              defaultValue={sectionId ?? ''}
              options={options}
            />
            <Button type="submit" variant="secondary" size="sm">
              {r('open')}
            </Button>
          </form>
        }
      >
        {sheet ? (
          <div style={{ overflowX: 'auto' }}>
            <table className="ep-table ep-table--dense" style={{ minWidth: 720 }}>
              <caption className="ep-kicker">
                {sheet.section.code} · {sheet.rows.length} {r('pupils').toLowerCase()}
              </caption>
              <thead>
                <tr>
                  <th>#</th>
                  <th>{r('pupil')}</th>
                  {sheet.subjects.map((s) => (
                    <th key={s.id} style={{ textAlign: 'right' }} title={s.name}>
                      {s.code}
                      <div className="ep-kicker">/ {s.maxMarks}</div>
                    </th>
                  ))}
                  <th style={{ textAlign: 'right' }}>{r('total')}</th>
                  <th style={{ textAlign: 'right' }}>{r('pct')}</th>
                  <th>{r('grade')}</th>
                  <th style={{ textAlign: 'right' }}>{r('rank')}</th>
                  <th>{r('result')}</th>
                </tr>
              </thead>
              <tbody>
                {sheet.rows.map((row) => (
                  <tr key={row.studentId}>
                    <td>{row.rollNo ?? ''}</td>
                    <td>
                      {row.name}
                      <div className="ep-kicker">{row.admissionNo}</div>
                    </td>
                    {sheet.subjects.map((s) => {
                      const m = row.marks[s.id];
                      return (
                        <td key={s.id} style={{ textAlign: 'right' }}>
                          {!m ? '' : m.absent ? r('ab') : m.exempt ? r('ex') : m.marks}
                        </td>
                      );
                    })}
                    <td style={{ textAlign: 'right' }}>
                      {row.total ? `${row.total} / ${row.maxTotal}` : ''}
                    </td>
                    <td style={{ textAlign: 'right' }}>{row.pct ?? ''}</td>
                    <td>{row.grade ?? ''}</td>
                    <td style={{ textAlign: 'right' }}>
                      {row.rankInSection ?? ''}
                      {row.rankInClass ? (
                        <span className="ep-kicker"> / {row.rankInClass}</span>
                      ) : null}
                    </td>
                    <td>
                      {row.result ? (
                        <Badge
                          tone={
                            row.result === 'pass'
                              ? 'success'
                              : row.result === 'fail'
                                ? 'danger'
                                : 'warning'
                          }
                        >
                          {r(row.result)}
                          {row.failedSubjects
                            ? ` · ${row.failedSubjects} ${r('failed').toLowerCase()}`
                            : ''}
                        </Badge>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="ep-field__help">{r('notComputed')}</p>
        )}
      </Card>
    </>
  );
}
