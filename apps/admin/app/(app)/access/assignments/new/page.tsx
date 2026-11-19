import {
  Breadcrumbs,
  Button,
  Card,
  FormRow,
  FormSection,
  InputField,
  PageHeader,
  SelectField,
} from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { PEOPLE_GROUPS, type AssignmentPeople, type PeopleGroup } from '@/lib/access-assignments';
import { grantRole } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type { ClassRow, Membership, Page, Role, School, SectionRow } from '@/lib/types';

const TYPES: Record<PeopleGroup, Array<Membership['personType']>> = {
  staff: ['employee', 'external'],
  parents: ['guardian'],
  students: ['student'],
  all: ['employee', 'external', 'guardian', 'student'],
};

/**
 * Access → Role assignments → Grant a role: find the person (staff first; up to 200 listed for a name, e-mail or
 * mobile), then the role and campus, the sections it is limited to (none ticked: every section), the dates and
 * the reason — in one go, so a role never reaches more than meant even for a moment. The API checks the
 * segregation of duties and asks for a recent multi-factor sign-in.
 */
export default async function GrantRolePage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    people?: string;
    userId?: string;
    roleId?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const [w, me] = await Promise.all([getTranslations('accessAssignments'), getMe()]);
  const people: PeopleGroup = PEOPLE_GROUPS.includes(sp.people as PeopleGroup)
    ? (sp.people as PeopleGroup)
    : 'staff';
  const q = (sp.q ?? '').trim().slice(0, 100);
  const userId = /^\d{1,18}$/.test(sp.userId ?? '') ? sp.userId! : '';
  const roleId = /^\d{1,18}$/.test(sp.roleId ?? '') ? sp.roleId! : '';
  const canManage = me.permissions.includes('access.assignment.manage');
  const find = (t: Membership['personType']) => {
    const x = new URLSearchParams({ personType: t, size: '200' });
    if (q) x.set('q', q);
    return apiFetch<Page<Membership>>(`/access/memberships?${x.toString()}`).then((r) => r.data);
  };
  const [found, roles, school, classes] = await Promise.all([
    Promise.all(TYPES[people].map(find)).then((xs) =>
      // each person once (several kinds of membership list them more than once)
      [
        ...new Map(
          xs
            .flat()
            .filter((m) => m.status === 'active')
            .map((m) => [m.userId, m]),
        ).values(),
      ]
        .sort((a, b) => a.displayName.localeCompare(b.displayName))
        .slice(0, 200),
    ),
    apiFetch<{ data: Role[] }>('/access/roles').then((r) =>
      r.data.filter((x) => x.status === 'active'),
    ),
    apiFetch<School>('/platform/school'),
    apiFetch<Page<ClassRow>>('/academics/classes?size=200').then((r) => r.data),
  ]);
  const sections = await Promise.all(
    classes.map((c) =>
      apiFetch<{ data: SectionRow[] }>(`/academics/classes/${c.id}/sections`)
        .then((r) => ({ cls: c, sections: r.data }))
        .catch(() => ({ cls: c, sections: [] as SectionRow[] })),
    ),
  );
  const withSections = sections.filter((x) => x.sections.length);
  const picked = found.some((m) => m.userId === userId)
    ? userId
    : found.length === 1
      ? found[0]!.userId
      : '';
  // the roles the person picked holds now, so a second grant of one is seen before it is refused
  const holds = picked
    ? await apiFetch<AssignmentPeople>(
        `/access/assignments/people?people=all&status=active&userId=${picked}`,
      ).then((r) => r.data[0]?.assignments ?? [])
    : [];
  const kind = (t: Membership['personType']) => w(`kind_${t}`);

  return (
    <>
      <Breadcrumbs
        items={[
          { label: w('kicker'), href: '/access/assignments' },
          { label: w('title'), href: '/access/assignments' },
          { label: w('grant') },
        ]}
      />
      <PageHeader kicker={w('kicker')} title={w('grant')} description={w('newDescription')} />
      <Notice params={sp} />

      <Card title={w('who')} style={{ marginBottom: 'var(--sp-5)' }}>
        <form
          method="get"
          action="/access/assignments/new"
          style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'flex-end', flexWrap: 'wrap' }}
        >
          <SelectField
            id="gr-people"
            name="people"
            label={w('people')}
            defaultValue={people}
            options={PEOPLE_GROUPS.map((x) => ({ value: x, label: w(`people_${x}`) }))}
          />
          <InputField
            id="gr-q"
            name="q"
            type="search"
            label={w('search')}
            placeholder={w('searchPlaceholder')}
            defaultValue={q}
          />
          <Button type="submit" variant="secondary">
            {w('find')}
          </Button>
        </form>
        <p className="ep-field__help" style={{ marginBottom: 0 }}>
          {found.length ? w('findHelp', { n: found.length }) : w('noPeople')}{' '}
          {found.length ? null : (
            <a href="/access/memberships" style={{ textDecoration: 'underline' }}>
              {w('members')}
            </a>
          )}
        </p>
      </Card>

      {!canManage ? (
        <Card>
          <p style={{ margin: 0 }}>{w('cannotGrant')}</p>
        </Card>
      ) : (
        <form action={grantRole}>
          <FormSection title={w('whoAndWhat')}>
            <FormRow columns={3}>
              <SelectField
                id="g-userId"
                name="userId"
                label={w('person')}
                required
                defaultValue={picked}
                options={[
                  { value: '', label: w('pickPerson') },
                  ...found.map((m) => ({
                    value: m.userId,
                    label: `${m.displayName} (${kind(m.personType)}${m.email ? ` · ${m.email}` : m.mobile ? ` · ${m.mobile}` : ''})`,
                  })),
                ]}
              />
              <SelectField
                id="g-roleId"
                name="roleId"
                label={w('role')}
                required
                defaultValue={roles.some((r) => r.id === roleId) ? roleId : ''}
                options={[
                  { value: '', label: w('pickRole') },
                  ...roles.map((r) => ({
                    value: r.id,
                    label: r.isSystem ? `${r.name} ${w('template')}` : r.name,
                  })),
                ]}
              />
              <SelectField
                id="g-campusId"
                name="campusId"
                label={w('campusLabel')}
                options={[
                  { value: '', label: w('campusAll') },
                  ...school.campuses.map((c) => ({ value: c.id, label: c.name })),
                ]}
              />
            </FormRow>
            {picked ? (
              <p className="ep-field__help" style={{ margin: 0 }}>
                {holds.length
                  ? w('holdsNow', { roles: holds.map((a) => a.roleName).join(', ') })
                  : w('holdsNone')}
              </p>
            ) : null}
          </FormSection>

          <FormSection title={w('sectionsTitle')} description={w('sectionsHelp')}>
            {withSections.length === 0 ? (
              <p className="ep-field__help" style={{ margin: 0 }}>
                {w('noClasses')}
              </p>
            ) : (
              <details>
                <summary style={{ cursor: 'pointer' }}>{w('sectionsOpen')}</summary>
                <div style={{ display: 'grid', gap: 'var(--sp-3)', marginTop: 'var(--sp-3)' }}>
                  {withSections.map(({ cls, sections: secs }) => (
                    <fieldset key={cls.id} style={{ border: 0, padding: 0, margin: 0 }}>
                      <legend className="ep-kicker" style={{ padding: 0 }}>
                        {cls.name}
                      </legend>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-3)' }}>
                        {secs.map((s) => (
                          <label key={s.id} className="ep-check" htmlFor={`g-sec-${s.id}`}>
                            <input
                              id={`g-sec-${s.id}`}
                              type="checkbox"
                              name="sectionIds"
                              value={s.id}
                              className="ep-check__input"
                            />
                            <span className="ep-check__box" aria-hidden="true" />
                            <span className="ep-check__text">{`${cls.code}-${s.name}`}</span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  ))}
                </div>
              </details>
            )}
          </FormSection>

          <FormSection title={w('whenAndWhy')}>
            <FormRow columns={3}>
              <InputField
                id="g-validFrom"
                name="validFrom"
                label={w('validFrom')}
                type="date"
                help={w('validFromHelp')}
              />
              <InputField
                id="g-validTo"
                name="validTo"
                label={w('validTo')}
                type="date"
                help={w('validToHelp')}
              />
              <InputField
                id="g-reason"
                name="reason"
                label={w('reasonLabel')}
                required
                minLength={3}
                maxLength={500}
                placeholder={w('reasonPh')}
              />
            </FormRow>
          </FormSection>
          <input
            type="hidden"
            name="back"
            value={`/access/assignments/new?people=${people}${q ? `&q=${encodeURIComponent(q)}` : ''}`}
          />
          <div style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'center' }}>
            <Button type="submit">{w('grantSubmit')}</Button>
            <a href="/access/assignments" style={{ textDecoration: 'underline' }}>
              {w('cancel')}
            </a>
          </div>
        </form>
      )}
    </>
  );
}
