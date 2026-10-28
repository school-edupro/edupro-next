import { Card, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { PaperEditor } from '@/components/admissions/PaperEditor';
import { PaperItemsEditor } from '@/components/admissions/PaperItemsEditor';
import type { PaperItemsView, PapersView } from '@/lib/admission-papers';
import { apiFetch, getMe } from '@/lib/api';

/**
 * Test and interview papers by class (docs/design/57, part 1): a Test or Interview stage's paper for
 * each class, its parts (subjects, or an interview's parameters) with maximum marks and an optional
 * pass mark, and a minimum total %. The class's maximum for the stage is the sum of its parts; a class
 * with no paper keeps the stage's maximum (one marks figure). The parts are picked from the school's
 * list, kept on the Subjects and parameters tab (follow-up of 28 Oct 2026).
 */
export default async function PapersPage({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string; class?: string; view?: string }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('admissions.cycle.view')) notFound();
  const canEdit = me.permissions.includes('admissions.setup.manage');
  const setup = await apiFetch<{
    stages: Array<{ id: string; name: string; kind: string; status: string }>;
  }>('/admissions/process-setup');
  const marked = setup.stages.filter(
    (s) => (s.kind === 'test' || s.kind === 'interview') && s.status === 'active',
  );
  const listView = sp.view === 'list' || !marked.length;
  const stageId = marked.some((s) => s.id === sp.stage) ? sp.stage! : marked[0]?.id;
  const header = (
    <PageHeader
      kicker="Admission set-up"
      title="Test and interview papers"
      description="The subjects of a written test and the parameters of an interview, class by class, each with its maximum marks. A class's maximum for the stage is the sum of its parts; a class with no paper takes one marks figure out of the stage's maximum. The subjects and parameters come from the school's own list."
      actions={
        <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/admissions/setup">
          Admission set-up
        </a>
      }
    />
  );
  const tabs = (
    <nav className="ep-lead-views" aria-label="Stages and the list">
      {marked.map((s) => (
        <a
          key={s.id}
          href={`/admissions/setup/papers?stage=${s.id}${sp.class ? `&class=${sp.class}` : ''}`}
          aria-current={!listView && s.id === stageId ? 'page' : undefined}
        >
          {s.name}
        </a>
      ))}
      <a href="/admissions/setup/papers?view=list" aria-current={listView ? 'page' : undefined}>
        Subjects and parameters
      </a>
    </nav>
  );

  if (listView) {
    const list = await apiFetch<PaperItemsView>('/admissions/paper-items');
    return (
      <>
        {header}
        {tabs}
        {!marked.length ? (
          <p>
            No Test or Interview stage is set up yet. Add one under Admission set-up → Stages, then
            give it its papers here.
          </p>
        ) : null}
        <Card title="Subjects and parameters">
          <PaperItemsEditor initial={list} canEdit={canEdit} />
        </Card>
      </>
    );
  }

  const data = await apiFetch<PapersView>(`/admissions/stages/${stageId!}/papers`);
  const chosen = data.classes.find((k) => k.id === sp.class) ?? data.classes[0];
  const isTest = data.stage.kind === 'test';
  return (
    <>
      {header}
      {tabs}
      {!chosen ? (
        <p>No class is set up yet (Academics → Classes).</p>
      ) : (
        <div className="ep-papers">
          <nav aria-label="Classes">
            <ul className="ep-papers__classes">
              {data.classes.map((k) => (
                <li key={k.id}>
                  <a
                    href={`/admissions/setup/papers?stage=${stageId!}&class=${k.id}`}
                    aria-current={k.id === chosen.id ? 'page' : undefined}
                  >
                    {k.name}
                    <small>
                      {k.paper
                        ? `${String(k.paper.parts.length)} ${isTest ? 'subject' : 'parameter'}${k.paper.parts.length === 1 ? '' : 's'} · out of ${String(k.paper.total)}`
                        : `One figure · out of ${String(data.stage.maxMarks ?? '-')}`}
                    </small>
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <Card title={`${chosen.name}: ${data.stage.name}`}>
            <PaperEditor
              key={`${stageId!}-${chosen.id}`}
              stage={data.stage}
              classId={chosen.id}
              className={chosen.name}
              paper={chosen.paper}
              items={data.items}
              others={data.classes
                .filter((k) => k.id !== chosen.id)
                .map((k) => ({ id: k.id, name: k.name, has: Boolean(k.paper) }))}
              canEdit={canEdit}
            />
          </Card>
        </div>
      )}
    </>
  );
}
