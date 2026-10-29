import { Breadcrumbs, Button, Card, KpiTile, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import {
  EntryStatusActions,
  EntryStatusBadge,
  type EntryStatus,
} from '@/components/exams/EntryStatusActions';
import { Notice } from '@/components/Notice';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import type { Exam } from '@/lib/types';

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
  const exam = await apiFetch<Exam>(`/exams/${id}`).catch((e: unknown) => {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  });
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
      <Breadcrumbs
        items={[
          { label: 'Exams', href: '/exams' },
          { label: exam.name, href: `/exams/${exam.id}` },
          { label: 'Marks status' },
        ]}
      />
      <PageHeader
        kicker={`Exams · ${exam.code}`}
        title={`Marks status · ${exam.name}`}
        description="Each subject of each section: entered by the teacher, submitted for verification, verified by the class teacher or a coordinator (then locked). Results are worked out again on every verification."
        actions={
          <a className="ep-btn ep-btn--secondary ep-btn--sm" href={`/exams/${exam.id}/marks`}>
            Marks entry
          </a>
        }
      />
      <Notice params={sp} />
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-3)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          marginBottom: 'var(--sp-4)',
        }}
      >
        <KpiTile label="Subjects × sections" value={String(r.counts.total)} />
        <KpiTile label="Open" value={String(r.counts.open)} />
        <KpiTile label="Missing marks" value={String(r.counts.missing)} />
        <KpiTile label="Waiting to verify" value={String(r.counts.submitted)} />
        <KpiTile label="Verified" value={String(r.counts.verified)} />
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
          <label className="ep-field" style={{ minWidth: 180 }}>
            <span className="ep-field__label">Class</span>
            <select className="ep-select" name="classId" defaultValue={classId ?? ''}>
              <option value="">Every class</option>
              {exam.classes.map((k) => (
                <option key={k.classId} value={k.classId}>
                  {k.classCode}
                </option>
              ))}
            </select>
          </label>
          <label className="ep-field" style={{ minWidth: 180 }}>
            <span className="ep-field__label">Status</span>
            <select className="ep-select" name="show" defaultValue={show}>
              <option value="">Any</option>
              <option value="open">Open</option>
              <option value="submitted">Waiting to verify</option>
              <option value="verified">Verified</option>
            </select>
          </label>
          <Button type="submit" variant="secondary">
            Show
          </Button>
        </form>
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Marks status">
          <table className="ep-table ep-table--dense">
            <caption className="ep-sr-only">Marks status</caption>
            <thead>
              <tr>
                <th scope="col">Section</th>
                <th scope="col">Subject</th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Entered
                </th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="ep-sr-only">Actions</span>
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
        {!rows.length ? <p style={{ marginBottom: 0 }}>Nothing to show.</p> : null}
      </Card>
    </>
  );
}
