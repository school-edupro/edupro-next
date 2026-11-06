import { Badge, Card, KpiTile } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { ExamFrame } from '@/components/exams/ExamFrame';
import { Meter } from '@/components/exams/Meter';
import { STAGE_TONE, StageSteps } from '@/components/exams/StageSteps';
import { WorkOutResults } from '@/components/exams/WorkOutResults';
import { nextStep } from '@/components/exams/next-step';
import { apiFetch, getMe } from '@/lib/api';
import { toggleClassLock } from '@/lib/exam-hub-actions';
import type { Exam, ExamDone, ExamProgress } from '@/lib/types';

type Area = 'marks' | 'indicators' | 'remarks' | 'attendance' | 'health';
const AREAS: Area[] = ['marks', 'indicators', 'remarks', 'attendance', 'health'];

/**
 * One exam's overview (docs/design/66): where it stands and the next step, what is left class by class
 * in every area (marks entered and verified, indicators, remarks, attendance, health, results), and the
 * entry locks, each locked or opened with one click.
 */
export default async function ExamOverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const [t, n, s, me, exam, p] = await Promise.all([
    getTranslations('examHub.overview'),
    getTranslations('examHub.next'),
    getTranslations('examHub.stage'),
    getMe(),
    apiFetch<Exam>(`/exams/${id}`),
    apiFetch<ExamProgress>(`/exams/${id}/progress`),
  ]);
  const canManage = me.permissions.includes('exams.master.manage');
  const canUnlock = me.permissions.includes('exams.marks.unlock');
  // 6 Nov 2026: locking and unlocking (the exam, a class) is the school admin's
  const canLock = me.permissions.includes('exams.lock.manage');
  const next = nextStep(exam.id, p);
  const m = p.totals.marks;
  const of = (a: number, b: number) => t('of', { a, b });
  const done = (d: ExamDone | null) => (d ? of(d.entered, d.expected) : t('none'));
  // only the areas the exam takes (docs/design/66)
  const on = (a: Area) => (exam.areas ?? AREAS).includes(a);
  const lockState = (classId: string, area: Area): 'locked' | 'open' | 'partly' => {
    if (area !== 'marks') {
      const k = exam.classes.find((x) => x.classId === classId);
      return k?.locks?.[area] ? 'locked' : 'open';
    }
    const rows = (exam.subjects ?? []).filter((x) => x.classId === classId);
    const locked = rows.filter((x) => x.entryLocked).length;
    return locked === 0 ? 'open' : locked === rows.length ? 'locked' : 'partly';
  };
  const stateWord = { locked: t('lockedState'), open: t('openState'), partly: t('partly') };
  return (
    <>
      <ExamFrame
        exam={exam}
        stage={p.stage}
        current="overview"
        canManage={canManage}
        canLock={canLock}
      />
      <Notice params={sp} />
      <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
        <StageSteps stage={p.stage} label={t('progress')} />
        <div className="ep-xnext">
          <p>
            <strong>{n('title')}:</strong> {n(next.key, { n: next.n })}
          </p>
          {/* the next step is to work the results out: the button itself, not a link */}
          {next.key === 'compute' && canManage ? null : (
            <a className="ep-btn ep-btn--primary ep-btn--sm" href={next.href}>
              {n(`${next.key}Go`)}
            </a>
          )}
        </div>
        {on('marks') ? (
          // 6 Nov 2026: Work out results lives here (the Results tab is gone)
          <div id="results" className="ep-xnext">
            <p>
              <strong>{t('results')}:</strong>
            </p>
            <WorkOutResults
              examId={exam.id}
              computedAt={
                p.classes
                  .map((k) => k.computedAt)
                  .filter((x): x is string => !!x)
                  .sort()
                  .at(-1) ?? null
              }
              canCompute={canManage}
              back={`/exams/${exam.id}`}
            />
          </div>
        ) : null}
        <div className="ep-kpis">
          <KpiTile label={t('students')} value={String(p.totals.students)} />
          {on('marks') ? (
            <>
              <KpiTile
                label={t('marksEntered')}
                value={
                  m.takers ? `${String(Math.round((m.entered / m.takers) * 100))}%` : t('none')
                }
                hint={m.takers ? of(m.entered, m.takers) : undefined}
              />
              <KpiTile
                label={t('verified')}
                value={m.slots ? of(m.verified, m.slots) : t('none')}
              />
              <KpiTile label={t('results')} value={of(p.totals.results, p.totals.students)} />
            </>
          ) : null}
          {on('indicators') && !on('marks') ? (
            <KpiTile
              label={t('indicators')}
              value={of(p.totals.indicators.entered, p.totals.indicators.expected)}
            />
          ) : null}
          {on('remarks') && !on('marks') ? (
            <KpiTile
              label={t('generalRemark')}
              value={of(p.totals.generalRemarks, p.totals.students)}
            />
          ) : null}
        </div>
        <Card title={t('byClass')}>
          {p.classes.length === 0 ? (
            <p style={{ margin: 0 }}>{t('noClasses')}</p>
          ) : (
            <div className="ep-table-wrap" tabIndex={0} role="region" aria-label={t('byClass')}>
              <table className="ep-table ep-table--dense">
                <caption className="ep-sr-only">{t('byClass')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('class')}</th>
                    {on('marks') ? (
                      <>
                        <th scope="col" className="is-numeric">
                          {t('subjects')}
                        </th>
                        <th scope="col">{t('marks')}</th>
                        <th scope="col">{t('verified')}</th>
                      </>
                    ) : null}
                    {on('indicators') ? <th scope="col">{t('indicators')}</th> : null}
                    {on('remarks') ? <th scope="col">{t('remarks')}</th> : null}
                    {on('attendance') || on('health') ? (
                      <th scope="col">{on('attendance') ? t('attendance') : t('health')}</th>
                    ) : null}
                    {on('marks') ? <th scope="col">{t('results')}</th> : null}
                    <th scope="col">{t('stage')}</th>
                    <th scope="col">
                      <span className="ep-sr-only">{t('setUp')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {p.classes.map((k) => (
                    <tr key={k.classId}>
                      <th scope="row">
                        {k.classCode}
                        <div className="ep-meter__text">
                          {t('students')}: {k.students}
                        </div>
                      </th>
                      {on('marks') ? (
                        <>
                          <td className="is-numeric">{k.subjects}</td>
                          <td>
                            {k.marks.takers ? (
                              <Meter
                                done={k.marks.entered}
                                of={k.marks.takers}
                                label={of(k.marks.entered, k.marks.takers)}
                              />
                            ) : (
                              t('none')
                            )}
                          </td>
                          <td>{k.marks.slots ? of(k.marks.verified, k.marks.slots) : t('none')}</td>
                        </>
                      ) : null}
                      {on('indicators') ? <td>{done(k.indicators)}</td> : null}
                      {on('remarks') ? (
                        <td>
                          {done(k.remarks)}
                          <div className="ep-meter__text">
                            {t('generalRemark')}: {of(k.generalRemarks, k.students)}
                          </div>
                        </td>
                      ) : null}
                      {on('attendance') || on('health') ? (
                        <td>
                          {on('attendance') ? of(k.attendance, k.students) : null}
                          {on('health') ? (
                            <div className="ep-meter__text">
                              {t('health')}: {of(k.health, k.students)}
                            </div>
                          ) : null}
                        </td>
                      ) : null}
                      {on('marks') ? (
                        <td>
                          {of(k.results, k.students)}
                          <div className="ep-meter__text">
                            {k.computedAt
                              ? t('computed', { when: k.computedAt.slice(0, 10) })
                              : t('notComputed')}
                          </div>
                        </td>
                      ) : null}
                      <td>
                        <Badge tone={STAGE_TONE[k.stage]}>{s(k.stage)}</Badge>
                      </td>
                      <td>
                        <a
                          className="ep-btn ep-btn--ghost ep-btn--sm"
                          href={`/exams/${exam.id}/setup?step=subjects&classId=${k.classId}`}
                          aria-label={`${t('setUp')} ${k.classCode}`}
                          style={{ whiteSpace: 'nowrap' }}
                        >
                          {t('setUp')}
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        {exam.classes.length ? (
          <Card title={t('locks')}>
            <p className="ep-field__help" style={{ marginTop: 0 }}>
              {t('locksHelp')}
            </p>
            <div className="ep-table-wrap" tabIndex={0} role="region" aria-label={t('locks')}>
              <table className="ep-table ep-table--dense">
                <caption className="ep-sr-only">{t('locks')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('class')}</th>
                    {AREAS.filter(on).map((a) => (
                      <th key={a} scope="col">
                        {t(a)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {exam.classes.map((k) => (
                    <tr key={k.classId}>
                      <th scope="row">{k.classCode}</th>
                      {AREAS.filter(on).map((a) => {
                        const st = lockState(k.classId, a);
                        const label = t('lockLabel', {
                          area: t(a),
                          class: k.classCode,
                          state: stateWord[st],
                        });
                        const blocked = st === 'locked' && !canUnlock;
                        return (
                          <td key={a}>
                            {canLock ? (
                              <form action={toggleClassLock}>
                                <input type="hidden" name="examId" value={exam.id} />
                                <input type="hidden" name="classId" value={k.classId} />
                                <input type="hidden" name="area" value={a} />
                                <input
                                  type="hidden"
                                  name="to"
                                  value={st === 'locked' ? 'open' : 'lock'}
                                />
                                <button
                                  type="submit"
                                  className="ep-xlock"
                                  aria-pressed={st === 'locked'}
                                  aria-label={label}
                                  disabled={blocked}
                                  title={blocked ? t('noUnlock') : undefined}
                                >
                                  <span aria-hidden="true">{st === 'open' ? '🔓' : '🔒'}</span>
                                  {stateWord[st]}
                                </button>
                              </form>
                            ) : (
                              <Badge tone={st === 'open' ? 'neutral' : 'warning'}>
                                {stateWord[st]}
                              </Badge>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ) : null}
      </div>
    </>
  );
}
