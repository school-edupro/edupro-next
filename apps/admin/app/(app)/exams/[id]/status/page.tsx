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
  classSectionId: string;
  section: string;
  takers: number;
  entered: number;
  canVerify: boolean;
}

/**
 * Marks status of an exam (docs/design/65, part 2): every section × subject with the students who take
 * it, how many are entered, and where it stands: open → submitted → verified. The verifier verifies or
 * sends back here; reopening needs the unlock right and a reason.
 */
export default async function ExamStatusPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    classId?: string;
    show?: string;
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
  const [t, st, exam, progress] = await Promise.all([
    getTranslations('examHub.entry'),
    getTranslations('examHub.status'),
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
  const show = ['open', 'submitted', 'verified'].includes(sp.show ?? '') ? sp.show : '';
  const rows = show ? r.data.filter((x) => x.status === show) : r.data;
  const canEnter = me.permissions.includes('exams.marks.enter');
  const canReopen = me.permissions.includes('exams.marks.unlock');
  const back = `/exams/${id}/status?${new URLSearchParams({
    ...(classId ? { classId } : {}),
    ...(show ? { show } : {}),
  }).toString()}`;
  return (
    <>
      <ExamFrame
        exam={exam}
        stage={progress?.stage ?? null}
        current="marks"
        canManage={me.permissions.includes('exams.master.manage')}
        canUnlock={canReopen}
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
        {st('intro')}
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
      <Card elevated>
        <form
          method="get"
          style={{
            display: 'flex',
            gap: 'var(--sp-3)',
            alignItems: 'flex-end',
            flexWrap: 'wrap',
            marginBottom: 'var(--sp-3)',
          }}
        >
          <label className="ep-field" htmlFor="st-class" style={{ minWidth: '11rem' }}>
            <span className="ep-field__label">{st('class')}</span>
            <select id="st-class" className="ep-select" name="classId" defaultValue={classId ?? ''}>
              <option value="">{st('everyClass')}</option>
              {exam.classes.map((k) => (
                <option key={k.classId} value={k.classId}>
                  {k.classCode}
                </option>
              ))}
            </select>
          </label>
          <label className="ep-field" htmlFor="st-show" style={{ minWidth: '11rem' }}>
            <span className="ep-field__label">{st('status')}</span>
            <select id="st-show" className="ep-select" name="show" defaultValue={show}>
              <option value="">{st('any')}</option>
              <option value="open">{st('open')}</option>
              <option value="submitted">{st('waiting')}</option>
              <option value="verified">{st('verified')}</option>
            </select>
          </label>
          <AutoSubmit />
          <noscript>
            <button type="submit" className="ep-btn ep-btn--secondary">
              {st('show')}
            </button>
          </noscript>
        </form>
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-label={st('title')}>
          <table className="ep-table ep-table--dense">
            <caption className="ep-sr-only">{st('title')}</caption>
            <thead>
              <tr>
                <th scope="col">{st('section')}</th>
                <th scope="col">{st('subject')}</th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  {st('entered')}
                </th>
                <th scope="col">{st('status')}</th>
                <th scope="col">
                  <span className="ep-sr-only">{st('actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((x) => (
                <tr key={`${x.examSubjectId}-${x.classSectionId}`}>
                  <td>{x.section}</td>
                  <td>
                    <a
                      href={`/exams/${exam.id}/marks?pick=${encodeURIComponent(`${x.classSectionId}|${x.subjectId}`)}`}
                      style={{ textDecoration: 'underline' }}
                    >
                      {x.subjectCode} · {x.subjectName}
                    </a>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {x.entered} / {x.takers}
                  </td>
                  <td>
                    <EntryStatusBadge s={x} />
                  </td>
                  <td>
                    <EntryStatusActions
                      examId={exam.id}
                      classSectionId={x.classSectionId}
                      subjectId={x.subjectId}
                      status={x.status}
                      back={back}
                      missing={Math.max(0, x.takers - x.entered)}
                      canSubmit={canEnter}
                      canVerify={x.canVerify}
                      canReopen={canReopen}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length ? <p style={{ marginBottom: 0 }}>{st('nothing')}</p> : null}
      </Card>
    </>
  );
}
