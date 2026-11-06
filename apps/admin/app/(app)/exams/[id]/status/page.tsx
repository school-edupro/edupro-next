import { Card, KpiTile } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { AutoSubmit } from '@/components/AutoSubmit';
import { ExamFrame } from '@/components/exams/ExamFrame';
import { SubNav } from '@/components/exams/SubNav';
import {
  EntryStatusActions,
  EntryStatusBadge,
  type EntryStatus,
} from '@/components/exams/EntryStatusActions';
import { Notice } from '@/components/Notice';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import type { Exam, ExamProgress } from '@/lib/types';

interface Row extends EntryStatus {
  examSubjectId: string;
  subjectId: string;
  subjectCode: string;
  subjectName: string;
  classId: string;
  classSectionId: string;
  section: string;
  takers: number;
  entered: number;
  canVerify: boolean;
  /** the section × subject's subject teachers (Teacher assignments) */
  teachers?: string[];
}
/** where a tile stands, for its colour */
type State = 'nobody' | 'notStarted' | 'inProgress' | 'ready' | 'submitted' | 'verified';

const stateOf = (x: Row): State => {
  if (x.status === 'verified') return 'verified';
  if (x.status === 'submitted') return 'submitted';
  if (x.takers === 0) return 'nobody';
  if (x.entered === 0) return 'notStarted';
  return x.entered >= x.takers ? 'ready' : 'inProgress';
};

/**
 * Marks status of an exam (docs/design/65, part 2) as a grid (docs/design/66): a block per class with a
 * row per section and a column per subject in the class's order. Each tile shows the marks entered out
 * of the students who take the subject and its stage (not started, in progress, entered, submitted,
 * verified); a row ends with the subjects verified, a column with the marks entered. A picked tile opens
 * above the grid with who submitted or verified it and its actions: submit, verify or send back,
 * reopen (the unlock right, with a reason).
 */
export default async function ExamStatusPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    classId?: string;
    cell?: string;
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
  const [t, st, esa, exam, progress] = await Promise.all([
    getTranslations('examHub.entry'),
    getTranslations('examHub.status'),
    getTranslations('examHub.esa'),
    apiFetch<Exam>(`/exams/${id}`).catch((e: unknown) => {
      if (e instanceof ApiError && e.status === 404) notFound();
      throw e;
    }),
    apiFetch<ExamProgress>(`/exams/${id}/progress`).catch(() => null),
  ]);
  const classId = exam.classes.some((k) => k.classId === sp.classId) ? sp.classId : undefined;
  const r = await apiFetch<{
    data: Row[];
    counts: { total: number; open: number; submitted: number; verified: number; missing: number };
  }>(`/exams/${id}/entry-status${classId ? `?classId=${classId}` : ''}`);
  const canEnter = me.permissions.includes('exams.marks.enter');
  const canReopen = me.permissions.includes('exams.marks.unlock');
  const base = `/exams/${id}/status${classId ? `?classId=${classId}` : ''}`;
  const link = (x: Row) =>
    `/exams/${id}/status?${new URLSearchParams({
      ...(classId ? { classId } : {}),
      cell: `${x.classSectionId}|${x.subjectId}`,
    }).toString()}#status-cell`;
  const picked = sp.cell
    ? r.data.find((x) => `${x.classSectionId}|${x.subjectId}` === sp.cell)
    : undefined;
  // the tile's teacher line: the subject teachers, or that nobody is mapped
  const who = (x: Row) => (x.teachers?.length ? x.teachers.join(', ') : st('noTeacher'));
  const label: Record<State, string> = {
    nobody: st('nobody'),
    notStarted: st('notStarted'),
    inProgress: st('inProgress'),
    ready: st('ready'),
    submitted: esa('submitted'),
    verified: esa('verified'),
  };
  // a block per class: its sections and its subjects in the order the rows come (the class's order)
  const blocks = exam.classes
    .filter((k) => !classId || k.classId === classId)
    .map((k) => {
      const rows = r.data.filter((x) => x.classId === k.classId);
      const sections = [...new Map(rows.map((x) => [x.classSectionId, x.section])).entries()];
      const subjects = [
        ...new Map(
          rows.map((x) => [x.subjectId, { code: x.subjectCode, name: x.subjectName }]),
        ).entries(),
      ];
      return { k, rows, sections, subjects };
    })
    .filter((b) => b.rows.length);

  return (
    <>
      <ExamFrame
        exam={exam}
        stage={progress?.stage ?? null}
        current="marks"
        canManage={me.permissions.includes('exams.master.manage')}
        canLock={me.permissions.includes('exams.lock.manage')}
      />
      <SubNav
        label={t('nav')}
        current={`/exams/${id}/status`}
        items={[
          { href: `/exams/${id}/marks`, label: t('navEnter') },
          { href: `/exams/${id}/status`, label: t('navStatus') },
        ]}
      />
      <p className="ep-field__help" style={{ marginTop: 0 }}>
        {st('gridIntro')}
      </p>
      <Notice params={sp} />
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-3)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          marginBottom: 'var(--sp-4)',
        }}
      >
        <KpiTile label={st('total')} value={String(r.counts.total)} />
        <KpiTile label={st('open')} value={String(r.counts.open)} />
        <KpiTile label={st('missing')} value={String(r.counts.missing)} />
        <KpiTile label={st('waiting')} value={String(r.counts.submitted)} />
        <KpiTile label={st('verified')} value={String(r.counts.verified)} />
      </div>

      {picked ? (
        <Card
          elevated
          id="status-cell"
          className="ep-statusgrid__cell"
          title={st('cellTitle', {
            section: picked.section,
            subject: `${picked.subjectName} (${picked.subjectCode})`,
          })}
          style={{ marginBottom: 'var(--sp-4)' }}
          actions={
            <span style={{ display: 'inline-flex', gap: 'var(--sp-2)' }}>
              <a
                className="ep-btn ep-btn--secondary ep-btn--sm"
                href={`/exams/${exam.id}/marks?pick=${encodeURIComponent(`${picked.classSectionId}|${picked.subjectId}`)}`}
              >
                {st('openSheet')}
              </a>
              <a className="ep-btn ep-btn--ghost ep-btn--sm" href={base}>
                {st('close')}
              </a>
            </span>
          }
        >
          <p style={{ marginTop: 0 }}>
            <strong>{st('enteredOf', { n: picked.entered, m: picked.takers })}</strong>{' '}
            <EntryStatusBadge s={picked} />
          </p>
          <p>
            {st('teacherIs', {
              names: picked.teachers?.length ? picked.teachers.join(', ') : st('noTeacher'),
            })}
          </p>
          <EntryStatusActions
            examId={exam.id}
            classSectionId={picked.classSectionId}
            subjectId={picked.subjectId}
            status={picked.status}
            back={`${base}${base.includes('?') ? '&' : '?'}cell=${encodeURIComponent(`${picked.classSectionId}|${picked.subjectId}`)}`}
            missing={Math.max(0, picked.takers - picked.entered)}
            canSubmit={canEnter}
            canVerify={picked.canVerify}
            canReopen={canReopen}
          />
        </Card>
      ) : null}

      <Card elevated>
        <div className="ep-statusgrid__tools">
          <form
            method="get"
            style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'flex-end' }}
          >
            <label className="ep-field" htmlFor="st-class" style={{ minWidth: '11rem' }}>
              <span className="ep-field__label">{st('class')}</span>
              <select
                id="st-class"
                className="ep-select"
                name="classId"
                defaultValue={classId ?? ''}
              >
                <option value="">{st('everyClass')}</option>
                {exam.classes.map((k) => (
                  <option key={k.classId} value={k.classId}>
                    {k.classCode}
                  </option>
                ))}
              </select>
            </label>
            <AutoSubmit />
            <noscript>
              <button type="submit" className="ep-btn ep-btn--secondary">
                {st('show')}
              </button>
            </noscript>
          </form>
          <ul className="ep-statusgrid__legend" aria-label={st('legend')}>
            {(
              ['notStarted', 'inProgress', 'ready', 'submitted', 'verified', 'nobody'] as State[]
            ).map((s) => (
              <li key={s}>
                <span className="ep-statusgrid__swatch" data-state={s} aria-hidden="true" />
                {label[s]}
              </li>
            ))}
          </ul>
        </div>
        {!picked ? <p className="ep-field__help">{st('pick')}</p> : null}

        {blocks.map((b) => (
          <section key={b.k.classId} className="ep-statusgrid__block" aria-label={b.k.classCode}>
            <h3 className="ep-statusgrid__title">
              {st('classBlock', {
                cls: b.k.classCode,
                sections: b.sections.length,
                subjects: b.subjects.length,
              })}
            </h3>
            <div className="ep-table-wrap" tabIndex={0} role="region" aria-label={b.k.classCode}>
              <table className="ep-table ep-statusgrid">
                <caption className="ep-sr-only">
                  {st('title')} · {b.k.classCode}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">{st('section')}</th>
                    {b.subjects.map(([sid, s]) => (
                      <th key={sid} scope="col" title={s.name}>
                        {s.code}
                      </th>
                    ))}
                    <th scope="col">{st('sectionDone')}</th>
                  </tr>
                </thead>
                <tbody>
                  {b.sections.map(([secId, code]) => {
                    const own = b.rows.filter((x) => x.classSectionId === secId);
                    const counted = own.filter((x) => x.takers > 0);
                    return (
                      <tr key={secId}>
                        <th scope="row">{code}</th>
                        {b.subjects.map(([sid, s]) => {
                          const x = own.find((y) => y.subjectId === sid);
                          if (!x) return <td key={sid} />;
                          const state = stateOf(x);
                          return (
                            <td key={sid}>
                              <a
                                className="ep-statusgrid__tile"
                                data-state={state}
                                aria-current={picked === x ? 'true' : undefined}
                                href={link(x)}
                                aria-label={`${st('tile', {
                                  subject: s.name,
                                  section: code,
                                  n: x.entered,
                                  m: x.takers,
                                  state: label[state],
                                })}, ${who(x)}`}
                              >
                                {state === 'nobody' ? (
                                  '—'
                                ) : (
                                  <>
                                    <span className="ep-statusgrid__num">
                                      {state === 'verified' ? '✓ ' : ''}
                                      {x.entered}/{x.takers}
                                    </span>
                                    <span className="ep-statusgrid__state">{label[state]}</span>
                                  </>
                                )}
                                {state === 'nobody' ? null : (
                                  <span
                                    className="ep-statusgrid__who"
                                    data-none={x.teachers?.length ? undefined : 'true'}
                                  >
                                    {who(x)}
                                  </span>
                                )}
                              </a>
                            </td>
                          );
                        })}
                        <td className="ep-statusgrid__sum">
                          {counted.filter((x) => x.status === 'verified').length}/{counted.length}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row">{st('columnTotal')}</th>
                    {b.subjects.map(([sid]) => {
                      const col = b.rows.filter((x) => x.subjectId === sid);
                      return (
                        <td key={sid} className="ep-statusgrid__sum">
                          {col.reduce((a, x) => a + x.entered, 0)}/
                          {col.reduce((a, x) => a + x.takers, 0)}
                        </td>
                      );
                    })}
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
        ))}
        {!blocks.length ? <p style={{ marginBottom: 0 }}>{st('nothing')}</p> : null}
      </Card>
    </>
  );
}
