import { Badge, Button, Card } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { AutoSubmit } from '@/components/AutoSubmit';
import { ExamFrame } from '@/components/exams/ExamFrame';
import { FormSaveBar } from '@/components/exams/FormSaveBar';
import { IndicatorSheet, type SheetArea } from '@/components/exams/IndicatorSheet';
import { ViewDownload } from '@/components/admissions/ViewDownload';
import { PortfolioUpload } from '@/components/exams/PortfolioUpload';
import { Notice } from '@/components/Notice';
import { removePortfolioPhoto, saveHpcFeedback } from '@/lib/hpc-actions';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import type { Exam, ExamProgress } from '@/lib/types';

interface Item {
  id: string;
  code: string;
  name: string;
  area: string | null;
  parentId: string | null;
  kind: 'level' | 'text';
  /** its own levels (a section with its own scale); none: the set's */
  levels?: string[] | null;
  description: string | null;
  descriptors: Record<string, string>;
  heading: boolean;
}
interface Sheet {
  exam: { id: string; code: string; name: string; marksLocked: boolean };
  section: { id: string; code: string };
  locked: boolean;
  set: {
    id: string;
    code: string;
    name: string;
    grades: string[];
    kind: 'indicators' | 'hpc';
    levelWords: Record<string, string>;
  } | null;
  indicators: Item[];
  rows: Array<{
    studentId: string;
    name: string;
    admissionNo: string;
    rollNo: number | null;
    grades: Record<string, { grade: string | null; note: string | null }>;
    feedback?: Record<string, { text: string; byFamily: boolean }>;
    photos?: number;
  }>;
}
interface Photo {
  id: string;
  studentId: string;
  caption: string | null;
  indicatorId: string | null;
  indicator: string | null;
}

/**
 * Indicators and the Holistic Progress Card of a section (docs/design/65, part 5; docs/design/66):
 * every area as a tab of one sheet saved together, a level (or a written note) per child and item, the
 * goals as headings; for a progress card, a child's own words, the parent's and the teacher's, and
 * portfolio photos. Choosing the section or the child opens it at once.
 */
export default async function ExamIndicatorsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    section?: string;
    area?: string;
    student?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const me = await getMe();
  if (!me.permissions.includes('exams.marks.view')) notFound();
  const [t, w, exam, progress] = await Promise.all([
    getTranslations('examHub.entry'),
    getTranslations('examHub.ind'),
    apiFetch<Exam>(`/exams/${id}`).catch((e: unknown) => {
      if (e instanceof ApiError && e.status === 404) notFound();
      throw e;
    }),
    apiFetch<ExamProgress>(`/exams/${id}/progress`).catch(() => null),
  ]);
  const sections = await apiFetch<{ data: Array<{ classSectionId: string; code: string }> }>(
    `/exams/${id}/entry/sections`,
  )
    .then((r) => r.data)
    .catch(() => []);
  const section = sections.find((x) => x.classSectionId === sp.section) ?? sections[0];
  const sheet = section
    ? await apiFetch<Sheet>(`/exams/${id}/indicators?classSectionId=${section.classSectionId}`)
    : null;
  const canEnter = me.permissions.includes('exams.indicator.enter');
  const open = canEnter && !!sheet && !sheet.locked;
  const items = sheet?.indicators ?? [];
  const areaNames = [...new Set(items.map((i) => i.area ?? 'Other'))];
  const area = areaNames.includes(sp.area ?? '') ? sp.area! : areaNames[0];
  const cell = (i: Item) => ({
    id: i.id,
    name: i.name,
    kind: i.kind,
    levels: i.levels ?? sheet?.set?.grades ?? [],
  });
  const areas: SheetArea[] = areaNames.map((name) => {
    const groups = items
      .filter((i) => !i.parentId && (i.area ?? 'Other') === name)
      .map((i) => ({
        id: i.id,
        name: i.name,
        kids: items.filter((k) => k.parentId === i.id).map(cell),
        self: cell(i),
      }));
    return {
      name,
      groups: groups.map(({ self: _self, ...g }) => g),
      cells: groups.flatMap((g) => (g.kids.length ? g.kids : [g.self])),
    };
  });
  const hpc = sheet?.set?.kind === 'hpc';
  const child = sheet?.rows.find((r) => r.studentId === sp.student) ?? sheet?.rows[0];
  const photos =
    hpc && section && child
      ? await apiFetch<{ data: Photo[] }>(
          `/exams/${id}/portfolio?classSectionId=${section.classSectionId}&studentId=${child.studentId}`,
        )
          .then((r) => r.data)
          .catch(() => [] as Photo[])
      : [];
  const q = (more: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({
      section: section?.classSectionId,
      area,
      student: child?.studentId,
      ...more,
    }))
      if (v) u.set(k, v);
    return `/exams/${id}/indicators?${u.toString()}`;
  };
  const level = (g: string) =>
    sheet?.set?.levelWords[g] ? `${g} (${sheet.set.levelWords[g]})` : g;
  return (
    <>
      <ExamFrame
        exam={exam}
        stage={progress?.stage ?? null}
        current="indicators"
        canManage={me.permissions.includes('exams.master.manage')}
        canLock={me.permissions.includes('exams.lock.manage')}
      />
      <Notice params={sp} />
      <Card style={{ marginBottom: 'var(--sp-4)' }}>
        <form method="get" className="ep-rp__row" aria-label={t('sheet')}>
          <AutoSubmit />
          <label className="ep-field" htmlFor="ind-section">
            <span className="ep-field__label">{t('section')}</span>
            <select
              id="ind-section"
              className="ep-select"
              name="section"
              defaultValue={section?.classSectionId}
            >
              {sections.map((x) => (
                <option key={x.classSectionId} value={x.classSectionId}>
                  {x.code}
                </option>
              ))}
            </select>
          </label>
          {area ? <input type="hidden" name="area" value={area} /> : null}
          <noscript>
            <Button type="submit" variant="secondary">
              {t('sheet')}
            </Button>
          </noscript>
        </form>
        {sheet?.set ? (
          <p className="ep-field__help" style={{ marginBottom: 0 }}>
            {sheet.set.name} · {t('levels', { levels: sheet.set.grades.map(level).join(', ') })}
          </p>
        ) : null}
      </Card>
      {sheet && !sheet.set ? (
        <Card>
          <p>{t('noSet', { section: sheet.section.code })}</p>
          <a
            className="ep-btn ep-btn--secondary ep-btn--sm"
            href={`/exams/${exam.id}/setup?step=subjects`}
          >
            {t('openSetup')}
          </a>
        </Card>
      ) : null}
      {sheet?.set && section ? (
        <>
          <Card
            style={{ marginBottom: 'var(--sp-4)' }}
            elevated
            title={sheet.section.code}
            actions={
              sheet.locked ? (
                <Badge tone="warning">{t('locked')}</Badge>
              ) : (
                <Badge tone="neutral">{t('children', { n: sheet.rows.length })}</Badge>
              )
            }
          >
            <IndicatorSheet
              key={section.classSectionId}
              examId={exam.id}
              classSectionId={section.classSectionId}
              areas={areas}
              rows={sheet.rows.map((r) => ({
                studentId: r.studentId,
                name: r.name,
                admissionNo: r.admissionNo,
                rollNo: r.rollNo,
                values: Object.fromEntries(
                  Object.entries(r.grades).map(([k, v]) => [k, v.grade ?? v.note ?? '']),
                ),
              }))}
              levelWords={sheet.set.levelWords}
              open={open}
              initialArea={area ?? ''}
            />
            {open ? null : (
              <p className="ep-field__help">
                {sheet.locked ? t('indicatorsLocked') : t('indicatorsViewOnly')}
              </p>
            )}
          </Card>
          {hpc && child ? (
            <Card elevated title={w('words', { name: child.name })}>
              <form
                method="get"
                style={{
                  display: 'flex',
                  gap: 'var(--sp-3)',
                  alignItems: 'flex-end',
                  flexWrap: 'wrap',
                }}
              >
                <input type="hidden" name="section" value={section.classSectionId} />
                {area ? <input type="hidden" name="area" value={area} /> : null}
                <AutoSubmit />
                <label className="ep-field" htmlFor="ind-child" style={{ minWidth: '15rem' }}>
                  <span className="ep-field__label">{t('child')}</span>
                  <select
                    id="ind-child"
                    className="ep-select"
                    name="student"
                    defaultValue={child.studentId}
                  >
                    {sheet.rows.map((r) => (
                      <option key={r.studentId} value={r.studentId}>
                        {r.rollNo ? `${String(r.rollNo)} · ` : ''}
                        {r.name} · {w('photos', { n: r.photos ?? 0 })}
                      </option>
                    ))}
                  </select>
                </label>
                <noscript>
                  <Button type="submit" variant="secondary">
                    {t('child')}
                  </Button>
                </noscript>
              </form>
              <div className="ep-rp" style={{ marginTop: 'var(--sp-3)' }}>
                <form action={saveHpcFeedback}>
                  <input type="hidden" name="examId" value={exam.id} />
                  <input type="hidden" name="classSectionId" value={section.classSectionId} />
                  <input type="hidden" name="studentId" value={child.studentId} />
                  <input type="hidden" name="back" value={q({})} />
                  {(
                    [
                      ['self', w('self')],
                      ['parent', w('parent')],
                      ['teacher', w('teacher')],
                    ] as const
                  ).map(([k, label]) => {
                    const f = child.feedback?.[k];
                    const theirs = k === 'parent' && f?.byFamily;
                    return (
                      <label key={k} className="ep-field">
                        <span className="ep-field__label">{label}</span>
                        <textarea
                          className="ep-input"
                          name={theirs ? undefined : k}
                          rows={3}
                          maxLength={2000}
                          defaultValue={f?.text ?? ''}
                          disabled={!open || Boolean(theirs)}
                        />
                        {theirs ? <span className="ep-field__help">{w('byFamily')}</span> : null}
                      </label>
                    );
                  })}
                  {open ? (
                    <FormSaveBar>
                      <Button type="submit" variant="secondary">
                        {w('saveWords')}
                      </Button>
                    </FormSaveBar>
                  ) : null}
                </form>
                <section aria-label={w('portfolio')}>
                  <h3 className="ep-cdash__h3" style={{ marginTop: 0 }}>
                    {w('portfolio')}
                  </h3>
                  {photos.length ? (
                    <ul style={{ paddingLeft: 'var(--sp-4)' }}>
                      {photos.map((p) => (
                        <li key={p.id} style={{ marginBottom: 'var(--sp-2)' }}>
                          {p.caption ?? w('photo')}
                          {p.indicator ? ` · ${p.indicator}` : ''}{' '}
                          <ViewDownload
                            href={`/api/exam-portfolio/${exam.id}/${p.id}`}
                            what={w('thePhoto', { caption: p.caption ?? '' }).trim()}
                          />
                          {open ? (
                            <form action={removePortfolioPhoto} style={{ display: 'inline' }}>
                              <input type="hidden" name="examId" value={exam.id} />
                              <input type="hidden" name="itemId" value={p.id} />
                              <input type="hidden" name="back" value={q({})} />{' '}
                              <button type="submit" className="ep-btn ep-btn--ghost ep-btn--sm">
                                {w('remove')}
                              </button>
                            </form>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="ep-field__help">{w('noPhoto')}</p>
                  )}
                  {open ? (
                    <PortfolioUpload
                      examId={exam.id}
                      classSectionId={section.classSectionId}
                      studentId={child.studentId}
                      items={items
                        .filter((i) => !i.heading && i.kind === 'level')
                        .map((i) => ({ id: i.id, name: i.name }))}
                    />
                  ) : null}
                </section>
              </div>
            </Card>
          ) : null}
        </>
      ) : null}
    </>
  );
}
