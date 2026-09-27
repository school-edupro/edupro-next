import {
  Badge,
  Button,
  Card,
  DataTable,
  FormActions,
  FormRow,
  FormSection,
  InputField,
  PageHeader,
  SelectField,
} from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { createEmployee } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type { Employee, Page, School } from '@/lib/types';

const TYPES = ['teaching', 'non_teaching', 'contract', 'visiting'] as const;

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<{
    ok?: string;
    error?: string;
    detail?: string;
    q?: string;
    employeeType?: string;
  }>;
}) {
  const sp = await searchParams;
  const [t, p, c, g, me] = await Promise.all([
    getTranslations('people.employees'),
    getTranslations('people'),
    getTranslations('common'),
    getTranslations('people.gender'),
    getMe(),
  ]);
  const params = new URLSearchParams({ size: '200' });
  if (sp.q) params.set('q', sp.q);
  if (sp.employeeType) params.set('employeeType', sp.employeeType);
  const [employees, school] = await Promise.all([
    apiFetch<Page<Employee>>(`/people/employees?${params.toString()}`),
    apiFetch<School>('/platform/school').catch(() => null),
  ]);
  const canCreate = me.permissions.includes('people.employee.create');
  return (
    <>
      <PageHeader kicker={p('kicker')} title={t('title')} description={t('description')} />
      <Notice params={sp} />
      <div className="ep-filter-band">
        <form
          method="get"
          style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'flex-end', flexWrap: 'wrap' }}
        >
          <InputField id="q" name="q" label={c('name')} defaultValue={sp.q ?? ''} />
          <SelectField
            id="employeeType"
            name="employeeType"
            label={t('type')}
            defaultValue={sp.employeeType ?? ''}
            options={[
              { value: '', label: c('all') },
              ...TYPES.map((v) => ({ value: v, label: t(`types.${v}`) })),
            ]}
          />
          <Button type="submit" variant="secondary">
            {c('filter')}
          </Button>
        </form>
      </div>
      <Card>
        <DataTable<Employee>
          caption={t('title')}
          columns={[
            {
              key: 'code',
              header: t('code'),
              render: (e) => <a href={`/people/employees/${e.id}`}>{e.employeeCode}</a>,
            },
            {
              key: 'name',
              header: c('name'),
              render: (e) => <a href={`/people/employees/${e.id}`}>{e.displayName}</a>,
            },
            { key: 'type', header: t('type'), render: (e) => t(`types.${e.employeeType}`) },
            {
              key: 'designation',
              header: t('designation'),
              render: (e) => e.posting?.designation ?? e.designation ?? '',
            },
            {
              key: 'department',
              header: t('department'),
              render: (e) => e.posting?.department ?? e.department ?? '',
            },
            { key: 'reportsTo', header: t('reportsTo'), render: (e) => e.posting?.reportsTo ?? '' },
            {
              key: 'status',
              header: c('status'),
              render: (e) => (
                <Badge tone={e.status === 'active' ? 'success' : 'danger'}>{e.status}</Badge>
              ),
            },
          ]}
          rows={employees.data}
          rowKey={(e) => e.id}
          emptyTitle={t('empty')}
        />
      </Card>
      {canCreate ? (
        <form action={createEmployee} style={{ marginTop: 'var(--sp-5)' }}>
          <FormSection title={t('new')} description={t('postingHelp')}>
            <FormRow columns={3}>
              <InputField id="employeeCode" name="employeeCode" label={t('code')} required />
              <InputField
                id="firstName"
                name="firstName"
                label={p('students.create.firstName')}
                required
              />
              <InputField id="lastName" name="lastName" label={p('students.create.lastName')} />
            </FormRow>
            <FormRow columns={4}>
              <SelectField
                id="employeeType"
                name="employeeType"
                label={t('type')}
                options={TYPES.map((v) => ({ value: v, label: t(`types.${v}`) }))}
              />
              <InputField id="designation" name="designation" label={t('designation')} />
              <InputField id="department" name="department" label={t('department')} />
              <SelectField
                id="gender"
                name="gender"
                label={p('students.create.gender')}
                options={(['unspecified', 'male', 'female', 'other'] as const).map((v) => ({
                  value: v,
                  label: g(v),
                }))}
              />
            </FormRow>
            <FormRow columns={4}>
              <InputField id="dob" name="dob" label={p('students.create.dob')} type="date" />
              <InputField id="joinedOn" name="joinedOn" label="Joined on" type="date" />
              <InputField id="mobile" name="mobile" label="Mobile" pattern="[6-9][0-9]{9}" />
              <InputField id="email" name="email" label="Email" type="email" />
            </FormRow>
            <FormRow columns={2}>
              <SelectField
                id="reportsToEmployeeId"
                name="reportsToEmployeeId"
                label={t('reportsTo')}
                options={[
                  { value: '', label: c('none') },
                  ...employees.data
                    .filter((e) => e.status === 'active')
                    .map((e) => ({ value: e.id, label: `${e.displayName} (${e.employeeCode})` })),
                ]}
              />
              <SelectField
                id="campusId"
                name="campusId"
                label={t('campus')}
                options={[
                  { value: '', label: c('none') },
                  ...(school?.campuses ?? []).map((x) => ({ value: x.id, label: x.name })),
                ]}
              />
            </FormRow>
          </FormSection>
          <FormActions>
            <Button type="submit">{t('submit')}</Button>
          </FormActions>
        </form>
      ) : null}
    </>
  );
}
