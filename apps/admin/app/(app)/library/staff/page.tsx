import { Badge, Breadcrumbs, Button, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import { changeLibraryStaff } from '@/lib/library-staff-actions';

type Staff = {
  canManage: boolean;
  mine: Array<{ id: string; name: string }> | null;
  libraries: Array<{
    id: string;
    code: string;
    name: string;
    status: string;
    staff: Array<{
      employeeId: string;
      name: string;
      code: string;
      designation: string | null;
      signsIn: boolean;
      by: string | null;
      at: string;
    }>;
  }>;
  employees: Array<{ id: string; name: string; code: string; designation: string | null }>;
};

/**
 * Library staff (docs/design/36-library.md, "Library round 3", part 3): each library with the staff who
 * work in it. Someone named on a library works only in the libraries they are named on (their books,
 * desk, stock, sales and reports); someone named on none works in every library. Only someone who works
 * in every library names the staff.
 */
export default async function LibraryStaffPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('library.catalogue.manage')) notFound();
  const data = await apiFetch<Staff>('/library/staff');
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Library', href: '/library' },
          { label: 'Library setup', href: '/masters/library' },
          { label: 'Library staff' },
        ]}
      />
      <PageHeader
        kicker="Library setup"
        title="Library staff"
        description="Name the staff of each library. A staff member named on a library works only in the libraries they are named on; one named on none works in every library."
      />
      <Notice params={sp} />
      {!data.canManage ? (
        <p className="ep-alert ep-alert--info" role="status">
          You work in {(data.mine ?? []).map((l) => l.name).join(', ')}. The library staff are named
          by someone who works in every library.
        </p>
      ) : null}
      <div className="ep-staff-libs">
        {data.libraries.map((l) => (
          <section key={l.id} className="ep-card" aria-labelledby={`ls-${l.id}`}>
            <h2 id={`ls-${l.id}`} className="ep-card__title">
              {l.name} <span className="ep-field__help">({l.code})</span>{' '}
              {l.status !== 'active' ? <Badge tone="neutral">Off</Badge> : null}
            </h2>
            {l.staff.length ? (
              <ul className="ep-staff-libs__list">
                {l.staff.map((s) => (
                  <li key={s.employeeId}>
                    <span>
                      <strong>{s.name}</strong>
                      <span className="ep-field__help">
                        {' '}
                        · {s.code}
                        {s.designation ? ` · ${s.designation}` : ''}
                        {s.signsIn ? '' : ' · has no sign-in yet'}
                      </span>
                    </span>
                    {data.canManage ? (
                      <form action={changeLibraryStaff}>
                        <input type="hidden" name="libraryId" value={l.id} />
                        <input type="hidden" name="employeeId" value={s.employeeId} />
                        <input type="hidden" name="change" value="remove" />
                        <Button type="submit" size="sm" variant="secondary">
                          Take off
                        </Button>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ep-field__help">
                No staff named: everyone with library rights who is named on no library works here.
              </p>
            )}
            {data.canManage ? (
              <form action={changeLibraryStaff} className="ep-dlog__filters">
                <input type="hidden" name="libraryId" value={l.id} />
                <input type="hidden" name="change" value="add" />
                <label
                  className="ep-field ep-dlog__search"
                  htmlFor={`ls-add-${l.id}`}
                  style={{ margin: 0 }}
                >
                  <span className="ep-field__label">Add a staff member</span>
                  <select
                    id={`ls-add-${l.id}`}
                    name="employeeId"
                    className="ep-select"
                    required
                    defaultValue=""
                  >
                    <option value="" disabled>
                      Pick a staff member
                    </option>
                    {data.employees
                      .filter((e) => !l.staff.some((s) => s.employeeId === e.id))
                      .map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.name} · {e.code}
                          {e.designation ? ` · ${e.designation}` : ''}
                        </option>
                      ))}
                  </select>
                </label>
                <Button type="submit" variant="secondary">
                  Add
                </Button>
              </form>
            ) : null}
          </section>
        ))}
      </div>
    </>
  );
}
