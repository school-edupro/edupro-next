import { Card, DataTable, PageHeader } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { FilterInput, FilterRow, Pager } from '@/components/RegisterTools';
import { StaffParentLogin } from '@/components/StaffParentLogin';
import { apiFetch, getMe } from '@/lib/api';
import type { StaffParentRow } from '@/lib/types';

const SIZE = 50;
type View = 'todo' | 'joined' | 'all';

/**
 * Students → Staff parents (0423): the father's, mother's and guardian's records marked "School staff: Yes" with an
 * employee code, first those not joined to the staff member's login yet. Joined, the staff member sees the child in
 * their own app (Staff and Parent, one sign-in) and on the family website.
 */
export default async function StaffParentsPage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string;
    q?: string;
    page?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('people.guardian.edit')) notFound();
  const r = await getTranslations('people.relation');
  const view: View = sp.view === 'joined' || sp.view === 'all' ? sp.view : 'todo';
  const q = (sp.q ?? '').trim().slice(0, 80);
  const page = Math.max(1, Number(sp.page) || 1);
  const query = (extra: Record<string, string>) =>
    new URLSearchParams({
      ...(view !== 'todo' ? { view } : {}),
      ...(q ? { q } : {}),
      ...extra,
    }).toString();
  const data = await apiFetch<{
    data: StaffParentRow[];
    counts: { todo: number; joined: number };
    page: { total: number };
  }>(
    `/people/staff-parents?${new URLSearchParams({
      state: view,
      ...(q ? { q } : {}),
      page: String(page),
      size: String(SIZE),
    }).toString()}`,
  );
  // where Join, Use staff login and Undo come back to: this view, its search and page
  const kept = query(page > 1 ? { page: String(page) } : {});
  const here = `/people/students/staff-parents${kept ? `?${kept}` : ''}`;
  const relationOf = (x: string) => {
    try {
      return r(x as 'father');
    } catch {
      return x;
    }
  };
  const pages = Math.max(1, Math.ceil(data.page.total / SIZE));
  return (
    <>
      <PageHeader
        kicker="Students"
        title="Staff parents"
        description="Fathers, mothers and guardians marked School staff with an employee code. Joined to the staff member's login, they see their child in their own app (Staff and Parent, one sign-in) and on the family website."
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/people/students">
            Students
          </a>
        }
      />
      <Notice params={sp} />
      <nav
        className="ep-tabs-links"
        aria-label="Staff parents"
        style={{ marginBottom: 'var(--sp-3)' }}
      >
        <a
          href={`/people/students/staff-parents${q ? `?${new URLSearchParams({ q }).toString()}` : ''}`}
          aria-current={view === 'todo' ? 'page' : undefined}
        >
          Not joined yet ({data.counts.todo})
        </a>
        <a
          href={`/people/students/staff-parents?${new URLSearchParams({ view: 'joined', ...(q ? { q } : {}) }).toString()}`}
          aria-current={view === 'joined' ? 'page' : undefined}
        >
          Joined ({data.counts.joined})
        </a>
        <a
          href={`/people/students/staff-parents?${new URLSearchParams({ view: 'all', ...(q ? { q } : {}) }).toString()}`}
          aria-current={view === 'all' ? 'page' : undefined}
        >
          All
        </a>
      </nav>
      <Card>
        <FilterRow
          clearHref={`/people/students/staff-parents${view !== 'todo' ? `?view=${view}` : ''}`}
          hidden={view !== 'todo' ? { view } : undefined}
        >
          <FilterInput id="q" label="Student, admission no, parent or employee code" value={q} />
        </FilterRow>
        <DataTable<StaffParentRow>
          caption="Staff parents"
          density="dense"
          columns={[
            {
              key: 'student',
              header: 'Student',
              render: (x) => (
                <>
                  <a
                    href={`/people/students/${x.studentId}?tab=profile`}
                    style={{ textDecoration: 'underline' }}
                  >
                    {x.studentName}
                  </a>
                  <span className="ep-field__help">
                    {' '}
                    {[x.admissionNo, x.section].filter(Boolean).join(' · ')}
                  </span>
                </>
              ),
            },
            {
              key: 'parent',
              header: 'Parent',
              render: (x) => (
                <>
                  {x.guardianName}
                  <span className="ep-field__help"> {relationOf(x.relation)}</span>
                </>
              ),
            },
            {
              key: 'login',
              header: 'Staff login',
              render: (x) => (
                <StaffParentLogin
                  guardianId={x.guardianId}
                  link={x}
                  relation={relationOf(x.relation).toLowerCase()}
                  canEdit
                  back={here}
                />
              ),
            },
          ]}
          rows={data.data}
          rowKey={(x) => `${x.studentId}-${x.guardianId}`}
          emptyTitle={
            view === 'todo'
              ? 'Every staff parent is joined to their staff login.'
              : 'No parent records marked School staff.'
          }
        />
        <Pager
          page={page}
          pages={pages}
          hrefFor={(n) => `/people/students/staff-parents?${query({ page: String(n) })}`}
        />
      </Card>
    </>
  );
}
