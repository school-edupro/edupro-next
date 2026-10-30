import { Button, Card } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { AutoSubmit } from '@/components/AutoSubmit';
import { ExamFrame } from '@/components/exams/ExamFrame';
import { type ExamReport, ReportTables } from '@/components/exams/ReportTables';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import type { Exam, ExamProgress } from '@/lib/types';

const KINDS = ['subjects', 'ranges', 'toppers', 'teachers', 'status', 'missing'] as const;
const FILTERS = [
  'classId',
  'classSectionId',
  'subjectId',
  'top',
  'minPct',
  'belowPct',
  'by',
  'ranges',
];

/**
 * An exam's analyses and exports (docs/design/65, part 6; docs/design/66): choose the report and its
 * filters (the choices apply at once; the figures with Show); each is shown here and comes as Excel
 * and PDF.
 */
export default async function ExamReportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const me = await getMe();
  if (!me.permissions.includes('exams.marks.view')) notFound();
  const [t, exam, progress, sections] = await Promise.all([
    getTranslations('examHub.reports'),
    apiFetch<Exam>(`/exams/${id}`).catch((e: unknown) => {
      if (e instanceof ApiError && e.status === 404) notFound();
      throw e;
    }),
    apiFetch<ExamProgress>(`/exams/${id}/progress`).catch(() => null),
    apiFetch<{ data: Array<{ classSectionId: string; classId: string; code: string }> }>(
      `/exams/${id}/entry/sections`,
    )
      .then((r) => r.data)
      .catch(() => [] as Array<{ classSectionId: string; classId: string; code: string }>),
  ]);
  const kind = KINDS.find((k) => k === sp.kind) ?? KINDS[0];
  // the sections of the class chosen (every section without one)
  const shown = sp.classId ? sections.filter((x) => x.classId === sp.classId) : sections;
  const sectionId = shown.some((x) => x.classSectionId === sp.classSectionId)
    ? sp.classSectionId
    : undefined;
  const subjects = [
    ...new Map((exam.subjects ?? []).map((x) => [x.subjectId, x.subjectName])).entries(),
  ];
  const q = new URLSearchParams();
  for (const k of FILTERS) {
    const v = k === 'ranges' ? sp[k]?.replace(/\s+/g, '') : sp[k]?.trim();
    if (v) q.set(k, v);
  }
  if (!sectionId) q.delete('classSectionId');
  // only the filters that report reads
  if (kind !== 'toppers')
    for (const k of ['subjectId', 'top', 'minPct', 'belowPct', 'by']) q.delete(k);
  if (kind !== 'ranges') q.delete('ranges');
  let report: ExamReport | null = null;
  let error: string | null = null;
  try {
    report = await apiFetch<ExamReport>(`/exams/${id}/reports/${kind}?${q.toString()}`);
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    error =
      (typeof e.problem.detail === 'string' && e.problem.detail) ||
      ((e.problem.errors as Array<{ message?: string }> | undefined)?.[0]?.message ??
        e.problem.type);
  }
  const field = (name: string, label: string, props: Record<string, unknown> = {}) => (
    <label className="ep-field" htmlFor={`rp-${name}`} style={{ minWidth: '7.5rem' }}>
      <span className="ep-field__label">{label}</span>
      <input
        id={`rp-${name}`}
        className="ep-input"
        name={name}
        defaultValue={sp[name] ?? ''}
        {...props}
      />
    </label>
  );
  return (
    <>
      <ExamFrame
        exam={exam}
        stage={progress?.stage ?? null}
        current="reports"
        canManage={me.permissions.includes('exams.master.manage')}
        canUnlock={me.permissions.includes('exams.marks.unlock')}
      />
      <Card style={{ marginBottom: 'var(--sp-4)' }}>
        <form method="get" className="ep-rp__row" aria-label={t('report')}>
          <AutoSubmit />
          <label className="ep-field" htmlFor="rp-kind" style={{ minWidth: '15rem' }}>
            <span className="ep-field__label">{t('report')}</span>
            <select id="rp-kind" className="ep-select" name="kind" defaultValue={kind}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`kinds.${k}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="ep-field" htmlFor="rp-class">
            <span className="ep-field__label">{t('class')}</span>
            <select
              id="rp-class"
              className="ep-select"
              name="classId"
              defaultValue={sp.classId ?? ''}
            >
              <option value="">{t('everyClass')}</option>
              {exam.classes.map((k) => (
                <option key={k.classId} value={k.classId}>
                  {k.classCode}
                </option>
              ))}
            </select>
          </label>
          <label className="ep-field" htmlFor="rp-section">
            <span className="ep-field__label">{t('section')}</span>
            <select
              id="rp-section"
              className="ep-select"
              name="classSectionId"
              defaultValue={sectionId ?? ''}
            >
              <option value="">{t('everySection')}</option>
              {shown.map((x) => (
                <option key={x.classSectionId} value={x.classSectionId}>
                  {x.code}
                </option>
              ))}
            </select>
          </label>
          {kind === 'toppers' ? (
            <>
              {field('top', t('top'), { type: 'number', min: 1, max: 100, placeholder: '10' })}
              <label className="ep-field" htmlFor="rp-by">
                <span className="ep-field__label">{t('rankIn')}</span>
                <select id="rp-by" className="ep-select" name="by" defaultValue={sp.by ?? 'class'}>
                  <option value="class">{t('theClass')}</option>
                  <option value="section">{t('theSection')}</option>
                </select>
              </label>
              {field('minPct', t('atOrAbove'), { type: 'number', min: 0, max: 100, step: '0.01' })}
              {field('belowPct', t('below'), { type: 'number', min: 0, max: 100, step: '0.01' })}
              <label className="ep-field" htmlFor="rp-subject" style={{ minWidth: '11rem' }}>
                <span className="ep-field__label">{t('subject')}</span>
                <select
                  id="rp-subject"
                  className="ep-select"
                  name="subjectId"
                  defaultValue={sp.subjectId ?? ''}
                >
                  <option value="">{t('overall')}</option>
                  {subjects.map(([sid, name]) => (
                    <option key={sid} value={sid}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : null}
          {kind === 'ranges'
            ? field('ranges', t('ranges'), {
                placeholder: '90, 75, 60, 45, 33, 0',
                pattern: '[0-9., ]{1,80}',
              })
            : null}
          {kind === 'toppers' || kind === 'ranges' ? (
            <div className="ep-field" style={{ alignSelf: 'flex-end' }}>
              <Button type="submit" variant="secondary">
                {t('show')}
              </Button>
            </div>
          ) : (
            <noscript>
              <Button type="submit" variant="secondary">
                {t('show')}
              </Button>
            </noscript>
          )}
        </form>
        <p className="ep-field__help" style={{ marginBottom: 0 }}>
          {t(`kinds.${kind}Help`)}
        </p>
      </Card>
      <Card elevated title={report?.title ?? t(`kinds.${kind}`)}>
        {report ? (
          <>
            <p className="ep-field__help" style={{ marginTop: 0 }}>
              {report.subtitle.join(' · ')}
            </p>
            <ReportTables
              report={report}
              files={{
                base: `/api/exam-report/${exam.id}/${kind}`,
                q: q.toString() ? encodeURIComponent(q.toString()) : '-',
              }}
            />
          </>
        ) : (
          <div className="ep-alert ep-alert--danger" role="alert">
            {error}
          </div>
        )}
      </Card>
    </>
  );
}
