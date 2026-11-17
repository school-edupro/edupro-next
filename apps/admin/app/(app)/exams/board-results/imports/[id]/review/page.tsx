import {
  Badge,
  Breadcrumbs,
  Button,
  Card,
  DataTable,
  KpiTile,
  PageHeader,
  SelectField,
} from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { pickBoardStudent } from '@/lib/board-actions';
import { MATCH_WORD, type BoardImportDetail, type BoardReview } from '@/lib/board-results';

type Cand = BoardReview['candidates'][number];

/**
 * Review students (docs/design/88, phase B): every candidate of a saved CBSE result file with the student it is
 * linked to — those not found first, each with the students of the class that year no candidate is linked to (the
 * likely ones first): link one, or mark "not our student"; a link can be undone. A link brings the student's details
 * and keeps the board roll number on the enrolment, so the next file finds them by it.
 */
export default async function BoardReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('exams.board_result.view')) notFound();
  let u: BoardImportDetail;
  let r: BoardReview;
  try {
    [u, r] = await Promise.all([
      apiFetch<BoardImportDetail>(`/exams/board-results/imports/${id}`),
      apiFetch<BoardReview>(`/exams/board-results/imports/${id}/review`),
    ]);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403 || e.status === 409))
      notFound();
    throw e;
  }
  const canImport = me.permissions.includes('exams.board_result.import');
  const count = (m: Cand['match'][]) => r.candidates.filter((c) => m.includes(c.match)).length;
  const byId = new Map(r.students.map((s) => [s.id, s]));
  const label = (s: BoardReview['students'][number]) =>
    `${s.name} · ${s.admissionNo} · ${s.section}${s.sex ? ` · ${s.sex}` : ''}`;
  const title = u.fileName ?? `CBSE result file ${u.id}`;

  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Board results', href: '/exams/board-results' },
          { label: 'Uploads', href: '/exams/board-results?tab=upload' },
          { label: title, href: `/exams/board-results/imports/${u.id}` },
          { label: 'Review students' },
        ]}
      />
      <PageHeader
        kicker={`Class ${r.classLabel} · ${String(r.examYear)} board examination`}
        title="Review students"
        description="Link each candidate of the file to the student. A candidate not found is linked here (the likely students first) or marked as not our student; a link brings the student's details and keeps the board roll number for the next file."
      />
      <Notice params={sp} />
      <div className="ep-dash-kpis">
        <KpiTile label="Candidates" value={String(r.candidates.length)} />
        <KpiTile label="By board roll no" value={String(count(['roll']))} />
        <KpiTile label="By name" value={String(count(['name']))} />
        <KpiTile label="Picked" value={String(count(['picked']))} />
        <KpiTile label="Not found" value={String(count(['none']))} />
        <KpiTile label="Not our students" value={String(count(['not_ours']))} />
      </div>
      <Card title="Candidates">
        <DataTable<Cand>
          caption="Candidates and their students"
          density="dense"
          columns={[
            { key: 'r', header: 'Roll no', render: (c) => <strong>{c.roll}</strong> },
            {
              key: 'n',
              header: 'Name in the file',
              render: (c) => (
                <>
                  {c.name ?? '—'}
                  {c.sex ? <span className="ep-ctype__num">{c.sex}</span> : null}
                </>
              ),
            },
            {
              key: 'm',
              header: 'Found',
              render: (c) => (
                <Badge
                  tone={
                    c.match === 'none' ? 'warning' : c.match === 'not_ours' ? 'neutral' : 'success'
                  }
                >
                  {MATCH_WORD[c.match]}
                </Badge>
              ),
            },
            {
              key: 's',
              header: 'Student',
              render: (c) =>
                c.student ? (
                  <>
                    <a href={`/people/students/${c.student.id}`}>{c.student.name}</a>
                    <span className="ep-ctype__num">{c.student.admissionNo ?? ''}</span>
                  </>
                ) : c.match === 'none' && canImport && r.students.length ? (
                  <form
                    action={pickBoardStudent}
                    style={{
                      display: 'flex',
                      gap: 'var(--sp-2)',
                      alignItems: 'flex-end',
                      flexWrap: 'wrap',
                    }}
                  >
                    <input type="hidden" name="importId" value={u.id} />
                    <input type="hidden" name="candidateId" value={c.id} />
                    <input type="hidden" name="how" value="link" />
                    <SelectField
                      id={`pick-${c.id}`}
                      name="studentId"
                      label={`Student for roll ${c.roll}`}
                      defaultValue={c.suggested[0] ?? ''}
                      options={[
                        { value: '', label: 'Choose…' },
                        ...c.suggested
                          .map((sid) => byId.get(sid))
                          .filter((s): s is NonNullable<typeof s> => Boolean(s))
                          .map((s) => ({ value: s.id, label: `${label(s)} (likely)` })),
                        ...r.students
                          .filter((s) => !c.suggested.includes(s.id))
                          .map((s) => ({ value: s.id, label: label(s) })),
                      ]}
                    />
                    <Button type="submit" size="sm">
                      Link
                    </Button>
                  </form>
                ) : (
                  '—'
                ),
            },
            {
              key: 'a',
              header: 'Actions',
              render: (c) =>
                canImport ? (
                  c.match === 'none' ? (
                    <form action={pickBoardStudent}>
                      <input type="hidden" name="importId" value={u.id} />
                      <input type="hidden" name="candidateId" value={c.id} />
                      <input type="hidden" name="how" value="not-ours" />
                      <Button type="submit" variant="ghost" size="sm">
                        Not our student
                      </Button>
                    </form>
                  ) : (
                    <form action={pickBoardStudent}>
                      <input type="hidden" name="importId" value={u.id} />
                      <input type="hidden" name="candidateId" value={c.id} />
                      <input type="hidden" name="how" value="unlink" />
                      <Button type="submit" variant="ghost" size="sm">
                        Unlink<span className="ep-sr-only"> roll {c.roll}</span>
                      </Button>
                    </form>
                  )
                ) : null,
            },
          ]}
          rows={r.candidates}
          rowKey={(c) => c.id}
          emptyTitle="No candidates"
        />
      </Card>
    </>
  );
}
