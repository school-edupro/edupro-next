import { Badge, Card, KpiTile, PageHeader } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { AutoSubmit } from '@/components/AutoSubmit';
import { Notice } from '@/components/Notice';
import { Meter } from '@/components/exams/Meter';
import { STAGE_TONE } from '@/components/exams/StageSteps';
import { nextStep } from '@/components/exams/next-step';
import { apiFetch, getMe } from '@/lib/api';
import type { ClassRow, Exam, ExamStage, ExamType, Page } from '@/lib/types';

const STAGES: ExamStage[] = ['setup', 'entry', 'verification', 'results', 'released'];

/**
 * The exams of the session (docs/design/66): each with its stage, how far marks have got and the next
 * step; found by name, type, class or stage. A new exam is made in steps on its own page.
 */
export default async function ExamsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    type?: string;
    classId?: string;
    stage?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const [t, s, n, a, me, exams, types, classes] = await Promise.all([
    getTranslations('examHub.list'),
    getTranslations('examHub.stage'),
    getTranslations('examHub.next'),
    getTranslations('examHub.areas'),
    getMe(),
    apiFetch<{ data: Exam[] }>('/exams').then((r) => r.data),
    apiFetch<{ data: ExamType[] }>('/exams/types').then((r) => r.data),
    apiFetch<Page<ClassRow>>('/academics/classes?size=200').then((r) => r.data),
  ]);
  const canManage = me.permissions.includes('exams.master.manage');
  const q = (sp.q ?? '').trim().toLowerCase();
  const shown = exams.filter(
    (e) =>
      (!q || e.name.toLowerCase().includes(q) || e.code.toLowerCase().includes(q)) &&
      (!sp.type || e.examTypeId === sp.type) &&
      (!sp.classId || e.classes.some((k) => k.classId === sp.classId)) &&
      (!sp.stage || e.progress?.stage === sp.stage),
  );
  const count = (st: ExamStage[]) =>
    exams.filter((e) => e.progress && st.includes(e.progress.stage)).length;
  const dates = (e: Exam) =>
    e.startsOn && e.endsOn
      ? t('dates', { from: e.startsOn, to: e.endsOn })
      : e.startsOn
        ? t('from', { from: e.startsOn })
        : t('noDates');
  return (
    <>
      <PageHeader
        kicker={t('title')}
        title={t('title')}
        description={t('description')}
        actions={
          canManage ? (
            <a className="ep-btn ep-btn--primary" href="/exams/new">
              {t('newExam')}
            </a>
          ) : null
        }
      />
      <Notice params={sp} />
      <div className="ep-kpis" style={{ marginBottom: 'var(--sp-4)' }}>
        <KpiTile label={s('setup')} value={String(count(['setup']))} />
        <KpiTile label={s('entry')} value={String(count(['entry']))} />
        <KpiTile label={s('verification')} value={String(count(['verification']))} />
        <KpiTile label={s('results')} value={String(count(['results', 'released']))} />
      </div>
      <Card title={t('filters')}>
        <form method="get" className="ep-rp__row" role="search" aria-label={t('filters')}>
          <AutoSubmit />
          <label className="ep-field" htmlFor="xq">
            <span className="ep-field__label">{t('search')}</span>
            <input
              id="xq"
              name="q"
              className="ep-input"
              type="search"
              defaultValue={sp.q ?? ''}
              placeholder={t('searchPlaceholder')}
            />
          </label>
          <label className="ep-field" htmlFor="xtype">
            <span className="ep-field__label">{t('type')}</span>
            <select id="xtype" name="type" className="ep-select" defaultValue={sp.type ?? ''}>
              <option value="">{t('allTypes')}</option>
              {types.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
          <label className="ep-field" htmlFor="xclass">
            <span className="ep-field__label">{t('class')}</span>
            <select
              id="xclass"
              name="classId"
              className="ep-select"
              defaultValue={sp.classId ?? ''}
            >
              <option value="">{t('allClasses')}</option>
              {classes.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name}
                </option>
              ))}
            </select>
          </label>
          <label className="ep-field" htmlFor="xstage">
            <span className="ep-field__label">{t('stage')}</span>
            <select id="xstage" name="stage" className="ep-select" defaultValue={sp.stage ?? ''}>
              <option value="">{t('anyStage')}</option>
              {STAGES.map((x) => (
                <option key={x} value={x}>
                  {s(x)}
                </option>
              ))}
            </select>
          </label>
          <div className="ep-field" style={{ alignSelf: 'flex-end' }}>
            <button type="submit" className="ep-btn ep-btn--secondary">
              {t('show')}
            </button>
          </div>
        </form>
      </Card>
      <div style={{ marginTop: 'var(--sp-4)' }}>
        {exams.length === 0 ? (
          <Card>
            <h2 className="ep-card__title">{t('noExams')}</h2>
            <p>{t('noExamsHelp')}</p>
            {canManage ? (
              <a className="ep-btn ep-btn--primary" href="/exams/new">
                {t('newExam')}
              </a>
            ) : null}
          </Card>
        ) : shown.length === 0 ? (
          <Card>
            <p style={{ margin: 0 }}>{t('noMatch')}</p>
          </Card>
        ) : (
          <ul className="ep-xcards" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {shown.map((e) => {
              const p = e.progress;
              const m = p?.totals.marks;
              const next = p ? nextStep(e.id, p) : null;
              return (
                <li key={e.id} className="ep-xcard">
                  <div className="ep-xcard__head">
                    <h2 className="ep-xcard__title">
                      <a href={`/exams/${e.id}`}>{e.name}</a>
                    </h2>
                    {p ? <Badge tone={STAGE_TONE[p.stage]}>{s(p.stage)}</Badge> : null}
                  </div>
                  <p className="ep-xcard__meta">
                    {e.code} · {e.examTypeName} · {dates(e)}
                  </p>
                  {e.areas && e.areas.length < 5 ? (
                    <p className="ep-xcard__meta">
                      {a('takes')}: {e.areas.map((x) => a(x as 'marks')).join(' · ')}
                    </p>
                  ) : null}
                  {e.classes.length ? (
                    <ul className="ep-xchips" aria-label={t('class')}>
                      {e.classes.map((k) => (
                        <li key={k.classId}>{k.classCode}</li>
                      ))}
                    </ul>
                  ) : null}
                  {m && m.takers > 0 ? (
                    <div style={{ display: 'grid', gap: 'var(--sp-1)' }}>
                      <Meter
                        done={m.entered}
                        of={m.takers}
                        label={t('marks', { entered: m.entered, takers: m.takers })}
                      />
                      {m.slots > 0 ? (
                        <span className="ep-meter__text">
                          {t('verified', { verified: m.verified, slots: m.slots })}
                        </span>
                      ) : null}
                    </div>
                  ) : p && p.totals.indicators.expected > 0 ? (
                    <Meter
                      done={p.totals.indicators.entered}
                      of={p.totals.indicators.expected}
                      label={t('indicators', {
                        entered: p.totals.indicators.entered,
                        expected: p.totals.indicators.expected,
                      })}
                    />
                  ) : (
                    <p className="ep-xcard__meta">{t('noMarks')}</p>
                  )}
                  {e.showOnPortal || e.marksLocked || e.status === 'inactive' ? (
                    <span style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-1)' }}>
                      {e.showOnPortal ? <Badge tone="info">{t('portal')}</Badge> : null}
                      {e.marksLocked ? <Badge tone="warning">{t('locked')}</Badge> : null}
                      {e.status === 'inactive' ? (
                        <Badge tone="neutral">{t('inactive')}</Badge>
                      ) : null}
                    </span>
                  ) : null}
                  <div className="ep-xcard__actions">
                    {next ? (
                      <a className="ep-btn ep-btn--primary ep-btn--sm" href={next.href}>
                        {n(`${next.key}Go`)}
                      </a>
                    ) : null}
                    <a
                      className="ep-btn ep-btn--ghost ep-btn--sm"
                      href={`/exams/${e.id}`}
                      aria-label={`${t('open')} ${e.name}`}
                    >
                      {t('open')}
                    </a>
                    {canManage ? (
                      <a
                        className="ep-btn ep-btn--ghost ep-btn--sm"
                        href={`/exams/new?from=${e.id}`}
                        aria-label={`${t('copy')} ${e.name}`}
                      >
                        {t('copy')}
                      </a>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
