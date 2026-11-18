import { Badge, Button, Card, DataTable, InputField, PageHeader, SelectField } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { ConfirmAction } from '@/components/ConfirmAction';
import { Notice } from '@/components/Notice';
import { Pager } from '@/components/Pager';
import {
  PEOPLE_GROUPS,
  STATE_TONE,
  STATUS_FILTERS,
  dmy,
  sectionWords,
  type AssignmentPeople,
  type PeopleGroup,
  type PersonAssignment,
  type StatusFilter,
} from '@/lib/access-assignments';
import { revokeAssignment } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type { Role } from '@/lib/types';

const SIZES = ['25', '50', '100'];

/**
 * Access → Role assignments: who holds which role, one row a person. The figures first (each opens its list), the
 * filters (name / e-mail / mobile, people, role, status), the roles held with their people (a click filters), then
 * the people — each opens to their roles with the sections, dates, who granted and why, the status, a way to the
 * sections and Revoke (a reason asked). Staff first; parents' and students' automatic roles one filter away.
 */
export default async function AssignmentsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    people?: string;
    status?: string;
    role?: string;
    userId?: string;
    page?: string;
    size?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const [w, me] = await Promise.all([getTranslations('accessAssignments'), getMe()]);
  const canManage = me.permissions.includes('access.assignment.manage');
  const people: PeopleGroup = PEOPLE_GROUPS.includes(sp.people as PeopleGroup)
    ? (sp.people as PeopleGroup)
    : 'staff';
  const status: StatusFilter = STATUS_FILTERS.includes(sp.status as StatusFilter)
    ? (sp.status as StatusFilter)
    : 'active';
  const role = /^\d{1,18}$/.test(sp.role ?? '') ? sp.role! : '';
  const userId = /^\d{1,18}$/.test(sp.userId ?? '') ? sp.userId! : '';
  const q = (sp.q ?? '').trim().slice(0, 100);
  const size = SIZES.includes(sp.size ?? '') ? sp.size! : '25';
  const page = /^\d{1,5}$/.test(sp.page ?? '') ? Math.max(1, Number(sp.page)) : 1;

  // the list's own address (filters kept) for paging, the role chips and the way back after a revoke
  const here = (over: Record<string, string> = {}) => {
    const x = new URLSearchParams();
    const v = { q, people, status, role, userId, size, page: String(page), ...over };
    if (v.q) x.set('q', v.q);
    if (v.people && v.people !== 'staff') x.set('people', v.people);
    if (v.status && v.status !== 'active') x.set('status', v.status);
    if (v.role) x.set('role', v.role);
    if (v.userId) x.set('userId', v.userId);
    if (v.size && v.size !== '25') x.set('size', v.size);
    if (v.page && v.page !== '1') x.set('page', v.page);
    const s = x.toString();
    return `/access/assignments${s ? `?${s}` : ''}`;
  };
  const api = new URLSearchParams({ people, status, page: String(page), size });
  if (q) api.set('q', q);
  if (role) api.set('roleId', role);
  if (userId) api.set('userId', userId);
  const [d, roles] = await Promise.all([
    apiFetch<AssignmentPeople>(`/access/assignments/people?${api.toString()}`),
    apiFetch<{ data: Role[] }>('/access/roles').then((r) => r.data),
  ]);
  const back = here();
  const stateWord = (a: PersonAssignment) =>
    a.state === 'ending'
      ? w('state_ending', { d: dmy(a.validTo) })
      : a.state === 'upcoming'
        ? w('state_upcoming', { d: dmy(a.validFrom) })
        : a.state === 'ended'
          ? w('state_ended', { d: dmy(a.validTo) })
          : w(`state_${a.state}`);
  const figures: Array<[string, number, string]> = [
    [w('f_staff'), d.figures.staff, '/access/assignments'],
    [w('f_parents'), d.figures.parents, '/access/assignments?people=parents'],
    [w('f_students'), d.figures.students, '/access/assignments?people=students'],
    [w('f_active'), d.figures.active, '/access/assignments?people=all'],
    [w('f_ending'), d.figures.ending, '/access/assignments?people=all&status=ending'],
    [w('f_revoked'), d.figures.revoked, '/access/assignments?people=all&status=revoked'],
  ];
  const filtered = Boolean(q || role || userId || people !== 'staff' || status !== 'active');
  const groupOf = (t: string) =>
    t === 'guardian' ? 'parents' : t === 'student' ? 'students' : 'staff';

  return (
    <>
      <PageHeader
        kicker={w('kicker')}
        title={w('title')}
        description={w('description')}
        actions={
          canManage ? (
            <a
              className="ep-btn ep-btn--primary"
              href="/access/assignments/new"
              style={{ whiteSpace: 'nowrap' }}
            >
              {w('grant')}
            </a>
          ) : undefined
        }
      />
      <Notice params={sp} />

      <div className="ep-dash-kpis" style={{ marginBottom: 'var(--sp-4)' }}>
        {figures.map(([label, n, href]) => (
          <a key={label} className="ep-card ep-card--elevated ep-staff-kpi" href={href}>
            <span className="ep-kpi__value">{n.toLocaleString('en-IN')}</span>
            <span className="ep-kpi__label">{label}</span>
          </a>
        ))}
      </div>

      <div className="ep-filter-band">
        <form
          method="get"
          action="/access/assignments"
          style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'flex-end', flexWrap: 'wrap' }}
        >
          <InputField
            id="as-q"
            name="q"
            type="search"
            label={w('search')}
            placeholder={w('searchPlaceholder')}
            defaultValue={q}
          />
          <SelectField
            id="as-people"
            name="people"
            label={w('people')}
            defaultValue={people}
            options={PEOPLE_GROUPS.map((x) => ({ value: x, label: w(`people_${x}`) }))}
          />
          <SelectField
            id="as-role"
            name="role"
            label={w('role')}
            defaultValue={role}
            options={[
              { value: '', label: w('allRoles') },
              ...roles.map((r) => ({ value: r.id, label: r.name })),
            ]}
          />
          <SelectField
            id="as-status"
            name="status"
            label={w('status')}
            defaultValue={status}
            options={STATUS_FILTERS.map((x) => ({ value: x, label: w(`status_${x}`) }))}
          />
          {size !== '25' ? <input type="hidden" name="size" value={size} /> : null}
          <Button type="submit" variant="secondary">
            {w('show')}
          </Button>
          {filtered ? (
            <a className="ep-btn ep-btn--secondary" href="/access/assignments">
              {w('clear')}
            </a>
          ) : null}
        </form>
      </div>

      <Card title={w('listTitle')}>
        {userId ? (
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            {w('onePerson')}{' '}
            <a href={here({ userId: '', page: '1' })} style={{ textDecoration: 'underline' }}>
              {w('showAll')}
            </a>
          </p>
        ) : null}
        {d.roles.length ? (
          <nav
            aria-label={w('rolesHeld')}
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 'var(--sp-2)',
              alignItems: 'center',
              marginBottom: 'var(--sp-4)',
            }}
          >
            <span className="ep-field__label" style={{ marginRight: 'var(--sp-1)' }}>
              {w('rolesHeld')}
            </span>
            {d.roles.map((r) => (
              <a
                key={r.id}
                href={here({ role: role === r.id ? '' : r.id, page: '1' })}
                aria-current={role === r.id ? 'true' : undefined}
                className={`ep-badge ep-badge--${role === r.id ? 'info' : 'neutral'}`}
                style={{ textDecoration: 'none' }}
              >
                {r.name} · {r.people}
              </a>
            ))}
          </nav>
        ) : null}

        {d.data.length === 0 ? (
          <div style={{ padding: 'var(--sp-5) 0' }}>
            <p className="ep-field__label" style={{ margin: 0 }}>
              {w('none')}
            </p>
            <p className="ep-field__help" style={{ marginBottom: 0 }}>
              {w('noneHint')}
            </p>
          </div>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {d.data.map((p) => (
              <li key={p.userId} style={{ borderTop: '1px solid var(--border-default)' }}>
                <details open={d.data.length === 1}>
                  <summary
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 'var(--sp-2) var(--sp-4)',
                      alignItems: 'center',
                      padding: 'var(--sp-3) var(--sp-1)',
                      cursor: 'pointer',
                    }}
                  >
                    <span style={{ flex: '1 1 14rem', minWidth: 0 }}>
                      <strong>{p.name}</strong>
                      <span className="ep-field__help" style={{ display: 'block' }}>
                        {[w(`kind_${p.personType}`), p.email ?? p.mobile ?? '']
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                    <span
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 'var(--sp-2)',
                        flex: '3 1 20rem',
                        minWidth: 0,
                      }}
                    >
                      {p.assignments.map((a) => (
                        <Badge
                          key={a.id}
                          tone={a.state === 'active' ? 'neutral' : STATE_TONE[a.state]}
                        >
                          {a.roleName}
                          {a.scopes.length ? ` · ${w('nSections', { n: a.scopes.length })}` : ''}
                          {a.state === 'active' ? '' : ` · ${stateWord(a)}`}
                        </Badge>
                      ))}
                    </span>
                    <span className="ep-field__help" style={{ marginLeft: 'auto' }}>
                      {w('nRoles', { n: p.assignments.length })} · {w('open')}
                    </span>
                  </summary>
                  <div style={{ padding: '0 var(--sp-1) var(--sp-4)' }}>
                    <DataTable<PersonAssignment>
                      caption={w('rolesOf', { name: p.name })}
                      density="dense"
                      columns={[
                        {
                          key: 'role',
                          header: w('col_role'),
                          render: (a) => (
                            <>
                              <a href={`/access/roles/${a.roleId}`}>{a.roleName}</a>
                              {a.campusName ? (
                                <span className="ep-field__help" style={{ display: 'block' }}>
                                  {w('campus', { campus: a.campusName })}
                                </span>
                              ) : null}
                            </>
                          ),
                        },
                        {
                          key: 'sections',
                          header: w('col_sections'),
                          render: (a) => sectionWords(a, w),
                        },
                        {
                          key: 'dates',
                          header: w('col_dates'),
                          render: (a) =>
                            a.validTo
                              ? w('fromTo', { from: dmy(a.validFrom), to: dmy(a.validTo) })
                              : w('from', { d: dmy(a.validFrom) }),
                        },
                        {
                          key: 'granted',
                          header: w('col_granted'),
                          render: (a) => (
                            <>
                              {a.grantedByName ? w('grantedBy', { name: a.grantedByName }) : '—'}
                              {a.reason ? (
                                <span className="ep-field__help" style={{ display: 'block' }}>
                                  {a.reason}
                                </span>
                              ) : null}
                            </>
                          ),
                        },
                        {
                          key: 'status',
                          header: w('col_status'),
                          render: (a) => <Badge tone={STATE_TONE[a.state]}>{stateWord(a)}</Badge>,
                        },
                        {
                          key: 'actions',
                          header: w('col_actions'),
                          render: (a) =>
                            a.revokedAt ? null : (
                              <span
                                style={{
                                  display: 'inline-flex',
                                  gap: 'var(--sp-2)',
                                  alignItems: 'center',
                                  flexWrap: 'wrap',
                                }}
                              >
                                <a
                                  className="ep-btn ep-btn--ghost ep-btn--sm"
                                  href={`/access/assignments/${a.id}`}
                                >
                                  {w('sectionsLink')}
                                </a>
                                {canManage && a.state !== 'ended' ? (
                                  <ConfirmAction
                                    action={revokeAssignment}
                                    fields={{ id: a.id, back }}
                                    label={w('revoke')}
                                    title={w('revokeTitle', { role: a.roleName, name: p.name })}
                                    confirmLabel={w('revoke')}
                                    variant="ghost"
                                    confirmVariant="danger"
                                    reason={{
                                      label: w('revokeReason'),
                                      placeholder: w('revokeReasonPh'),
                                    }}
                                  >
                                    {w('revokeBody')}
                                  </ConfirmAction>
                                ) : null}
                              </span>
                            ),
                        },
                      ]}
                      rows={p.assignments}
                      rowKey={(a) => a.id}
                      emptyTitle={w('none')}
                    />
                    {canManage ? (
                      <p style={{ marginBottom: 0 }}>
                        <a
                          href={`/access/assignments/new?userId=${p.userId}&q=${encodeURIComponent(p.name)}&people=${groupOf(p.personType)}`}
                          style={{ textDecoration: 'underline' }}
                        >
                          {w('grantAnother')}
                        </a>
                      </p>
                    ) : null}
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 'var(--sp-3)',
            flexWrap: 'wrap',
            alignItems: 'flex-end',
            marginTop: 'var(--sp-3)',
          }}
        >
          <Pager
            page={page}
            size={Number(size)}
            total={d.page.total}
            href={(n) => here({ page: String(n) })}
            noun={d.page.total === 1 ? w('personNoun') : w('peopleNoun')}
          />
          <form
            method="get"
            action="/access/assignments"
            style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'flex-end' }}
          >
            {q ? <input type="hidden" name="q" value={q} /> : null}
            {people !== 'staff' ? <input type="hidden" name="people" value={people} /> : null}
            {status !== 'active' ? <input type="hidden" name="status" value={status} /> : null}
            {role ? <input type="hidden" name="role" value={role} /> : null}
            <SelectField
              id="as-size"
              name="size"
              label={w('perPage')}
              defaultValue={size}
              options={SIZES.map((x) => ({ value: x, label: x }))}
            />
            <Button type="submit" variant="ghost" size="sm">
              {w('show')}
            </Button>
          </form>
        </div>
      </Card>
    </>
  );
}
