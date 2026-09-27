import { Badge, Breadcrumbs, Button, Card, PageHeader } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { setAssignmentScopes } from '@/lib/actions';
import { apiFetch } from '@/lib/api';
import type { Assignment, ClassRow, Page, SectionRow } from '@/lib/types';

export default async function AssignmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const [assignment, classes] = await Promise.all([
    apiFetch<Assignment>(`/access/assignments/${id}`),
    apiFetch<Page<ClassRow>>('/academics/classes?size=200'),
  ]);
  return <ScopeEditor assignment={assignment} classes={classes.data} sp={sp} />;
}

async function ScopeEditor({
  assignment,
  classes,
  sp,
}: {
  assignment: Assignment;
  classes: ClassRow[];
  sp: { ok?: string; error?: string; detail?: string };
}) {
  const t = await getTranslations('pages.access_assignments_detail');
  const sections = await Promise.all(
    classes.map((c) =>
      apiFetch<{ data: SectionRow[] }>(`/academics/classes/${c.id}/sections`)
        .then((r) => ({ cls: c, sections: r.data }))
        .catch(() => ({ cls: c, sections: [] as SectionRow[] })),
    ),
  );
  const selected = new Set(
    assignment.scopes.filter((s) => s.type === 'class_section').map((s) => s.id),
  );
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Access', href: '/access/assignments' },
          { label: 'Assignments', href: '/access/assignments' },
          { label: `${assignment.userName} · ${assignment.roleName}` },
        ]}
      />
      <PageHeader
        kicker={t('kicker')}
        title={`${assignment.userName}: ${assignment.roleName}`}
        description={t('description')}
        actions={
          <Badge tone={assignment.active ? 'success' : 'danger'}>
            {assignment.active ? 'active' : 'inactive'}
          </Badge>
        }
      />
      <Notice params={sp} />
      <Card title="Class section scopes">
        <form action={setAssignmentScopes} style={{ display: 'grid', gap: 'var(--sp-4)' }}>
          <input type="hidden" name="id" value={assignment.id} />
          {sections.length === 0 ? <p>No classes defined yet.</p> : null}
          {sections.map(({ cls, sections: secs }) => (
            <div key={cls.id}>
              <div className="ep-kicker">{cls.name}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-3)' }}>
                {secs.length === 0 ? (
                  <span className="ep-field__help">No sections in the working year</span>
                ) : null}
                {secs.map((s) => (
                  <label key={s.id} className="ep-check" htmlFor={`sec-${s.id}`}>
                    <input
                      id={`sec-${s.id}`}
                      type="checkbox"
                      name="sectionIds"
                      value={s.id}
                      className="ep-check__input"
                      defaultChecked={selected.has(s.id)}
                      disabled={!!assignment.revokedAt}
                    />
                    <span className="ep-check__box" aria-hidden="true" />
                    <span className="ep-check__text">{`${cls.code}-${s.name}`}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
          {assignment.revokedAt ? null : (
            <div>
              <Button type="submit">Save scopes</Button>
            </div>
          )}
        </form>
      </Card>
    </>
  );
}
