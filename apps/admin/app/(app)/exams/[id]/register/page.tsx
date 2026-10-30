import { Badge, Button, Card, SelectField } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { AutoSubmit } from '@/components/AutoSubmit';
import { Notice } from '@/components/Notice';
import { ViewDownload } from '@/components/admissions/ViewDownload';
import { ExamFrame } from '@/components/exams/ExamFrame';
import { ResultsHead } from '@/components/exams/ResultsHead';
import { apiFetch, getMe } from '@/lib/api';
import type { Exam, ExamProgress, RegisterSheet } from '@/lib/types';

/**
 * Sprint 16: the mark register of one section (pupils × subjects with totals, grade and rank);
 * docs/design/66: in the Results tab, the section applies on change, Excel and PDF beside it.
 */
export default async function RegisterPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ section?: string; ok?: string; error?: string; detail?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const [x, r, me, exam, progress, sections] = await Promise.all([
    getTranslations('examHub.results'),
    getTranslations('results'),
    getMe(),
    apiFetch<Exam>(`/exams/${id}`),
    apiFetch<ExamProgress>(`/exams/${id}/progress`).catch(() => null),
    apiFetch<{ data: Array<{ classSectionId: string; code: string }> }>(
      `/exams/${id}/entry/sections`,
    )
      .then((v) => v.data)
      .catch(() => [] as Array<{ classSectionId: string; code: string }>),
  ]);
  // the exam's sections the caller reads
  const options = sections.map((v) => ({ value: v.classSectionId, label: v.code }));
  const sectionId = options.some((o) => o.value === sp.section) ? sp.section : options[0]?.value;
  const sheet = sectionId
    ? await apiFetch<RegisterSheet>(
        `/exams/${id}/register-sheet?classSectionId=${sectionId}`,
      ).catch(() => null)
    : null;
  const canManage = me.permissions.includes('exams.master.manage');
  return (
    <>
      <ExamFrame
        exam={exam}
        stage={progress?.stage ?? null}
        current="results"
        canManage={canManage}
        canUnlock={me.permissions.includes('exams.marks.unlock')}
      />
      <ResultsHead
        examId={id}
        current="register"
        computedAt={sheet?.exam.computedAt ?? null}
        canCompute={canManage}
        back={`/exams/${id}/register?section=${sectionId ?? ''}`}
      />
      <Notice params={sp} />
      <Card
        title={sheet ? `${r('register')} · ${sheet.section.code}` : r('register')}
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', alignItems: 'flex-end' }}>
            <form method="get">
              <AutoSubmit />
              <SelectField
                id="section"
                name="section"
                label={r('section')}
                defaultValue={sectionId ?? ''}
                options={options}
              />
              <noscript>
                <Button type="submit" variant="secondary" size="sm">
                  {r('open')}
                </Button>
              </noscript>
            </form>
            {sheet && sectionId ? (
              <>
                <a
                  className="ep-btn ep-btn--secondary ep-btn--sm"
                  href={`/api/exam-register-sheet/${id}/${sectionId}/xlsx`}
                >
                  {x('excel')}
                </a>
                <ViewDownload
                  href={`/api/exam-register-sheet/${id}/${sectionId}/pdf`}
                  what={`${x('registerFile')} PDF`}
                />
              </>
            ) : null}
          </span>
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
