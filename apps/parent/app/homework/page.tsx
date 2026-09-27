import { Badge, Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

interface Work {
  id: string;
  kind: 'homework' | 'classwork' | 'assignment';
  classSectionId: string;
  section: string;
  subjectName: string | null;
  title: string;
  body: string;
  assignedOn: string;
  dueOn: string | null;
  postedBy: string | null;
  files: Array<{ id: string; name: string | null }>;
}
interface Viewer {
  kind: 'staff' | 'family';
  students: Array<{
    id: string;
    name: string;
    classSectionId: string | null;
    section: string | null;
  }>;
}

/** S7-08: homework, classwork and assignments of the guardian's children, one child at a time. */
export default async function HomeworkPage({
  searchParams,
}: {
  searchParams: Promise<{ child?: string }>;
}) {
  const sp = await searchParams;
  let viewer: Viewer;
  try {
    viewer = await bff.api.fetch<Viewer>('/academics/daily-work/viewer');
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && error.status === 403)
      return (
        <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
          <PageHeader kicker="EduPro" title="Homework" />
          <Card>
            Your account is not linked to a student yet. Please contact the school office.
          </Card>
        </main>
      );
    throw error;
  }
  const kids = viewer.students.filter((s) => s.classSectionId);
  const child = kids.find((k) => k.id === sp.child) ?? kids[0];
  const work = child
    ? await bff.api
        .fetch<{ data: Work[] }>(
          `/academics/daily-work?size=50&classSectionId=${child.classSectionId}`,
        )
        .then((r) => r.data)
    : [];
  const byDate = new Map<string, Work[]>();
  for (const w of work) byDate.set(w.assignedOn, [...(byDate.get(w.assignedOn) ?? []), w]);
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
      <PageHeader
        kicker="Homework"
        title={child ? `${child.name} · ${child.section}` : 'Homework'}
        description={child ? `${work.length} items this term` : 'No enrolled child found'}
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/">
            Home
          </a>
        }
      />
      {kids.length > 1 ? (
        <div
          style={{
            display: 'flex',
            gap: 'var(--sp-2)',
            marginBottom: 'var(--sp-4)',
            flexWrap: 'wrap',
          }}
        >
          {kids.map((k) => (
            <a
              key={k.id}
              href={`/homework?child=${k.id}`}
              className={`ep-btn ep-btn--sm ${k.id === child?.id ? '' : 'ep-btn--secondary'}`}
            >
              {k.name} ({k.section})
            </a>
          ))}
        </div>
      ) : null}
      {[...byDate.entries()].map(([date, items]) => (
        <Card
          key={date}
          title={new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          })}
          style={{ marginBottom: 'var(--sp-4)' }}
        >
          {items.map((w) => (
            <div
              key={w.id}
              style={{ padding: 'var(--sp-2) 0', borderTop: '1px solid var(--border-subtle)' }}
            >
              <div
                style={{
                  display: 'flex',
                  gap: 'var(--sp-2)',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                }}
              >
                <Badge
                  tone={
                    w.kind === 'homework' ? 'info' : w.kind === 'assignment' ? 'warning' : 'neutral'
                  }
                >
                  {w.kind}
                </Badge>
                <strong>{w.subjectName ?? ''}</strong>
                {w.dueOn ? <span className="ep-kicker">due {w.dueOn}</span> : null}
              </div>
              <div style={{ marginTop: 'var(--sp-1)' }}>{w.title}</div>
              {w.body ? (
                <div style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-small)' }}>
                  {w.body}
                </div>
              ) : null}
              {w.files.length ? (
                <div className="ep-kicker">{w.files.map((f) => f.name ?? 'file').join(', ')}</div>
              ) : null}
              {w.postedBy ? <div className="ep-kicker">{w.postedBy}</div> : null}
            </div>
          ))}
        </Card>
      ))}
      {child && work.length === 0 ? <Card>No homework posted yet.</Card> : null}
    </main>
  );
}
