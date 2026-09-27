import {
  Badge,
  Breadcrumbs,
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
import { requestEmployeeIdCard, updateEmployee, upsertPosting } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type { Employee, Employee360, Page, PersonDocument, Posting, School } from '@/lib/types';

const TYPES = ['teaching', 'non_teaching', 'contract', 'visiting'] as const;

export default async function EmployeePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const [t, p, c, me, employee, others, school] = await Promise.all([
    getTranslations('people.employees'),
    getTranslations('people'),
    getTranslations('common'),
    getMe(),
    apiFetch<Employee360>(`/people/employees/${id}`),
    apiFetch<Page<Employee>>('/people/employees?size=200&status=active'),
    apiFetch<School>('/platform/school').catch(() => null),
  ]);
  const canEdit = me.permissions.includes('people.employee.edit');
  return (
    <>
      <Breadcrumbs
        items={[
          { label: p('kicker'), href: '/people/employees' },
          { label: t('title'), href: '/people/employees' },
          { label: employee.displayName },
        ]}
      />
      <PageHeader
        kicker={p('kicker')}
        title={employee.displayName}
        description={
          <>
            {t('code')} <strong>{employee.employeeCode}</strong> ·{' '}
            {t(`types.${employee.employeeType}`)}
            {employee.posting
              ? ` · ${employee.posting.designation ?? ''}${employee.posting.department ? `, ${employee.posting.department}` : ''}`
              : ''}
          </>
        }
        actions={
          <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
            <Badge tone={employee.status === 'active' ? 'success' : 'danger'}>
              {employee.status}
            </Badge>
            <form action={requestEmployeeIdCard}>
              <input type="hidden" name="id" value={employee.id} />
              <Button type="submit" variant="secondary" size="sm">
                {p('students.requestIdCard')}
              </Button>
            </form>
          </div>
        }
      />
      <Notice params={sp} />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
          gap: 'var(--sp-4)',
        }}
      >
        <Card title={p('students.profile')}>
          <form action={updateEmployee} style={{ display: 'grid', gap: 'var(--sp-3)' }}>
            <input type="hidden" name="id" value={employee.id} />
            <FormRow columns={2}>
              <InputField
                id="firstName"
                name="firstName"
                label={p('students.create.firstName')}
                defaultValue={employee.firstName}
                required
                disabled={!canEdit}
              />
              <InputField
                id="lastName"
                name="lastName"
                label={p('students.create.lastName')}
                defaultValue={employee.lastName ?? ''}
                disabled={!canEdit}
              />
            </FormRow>
            <FormRow columns={2}>
              <SelectField
                id="employeeType"
                name="employeeType"
                label={t('type')}
                defaultValue={employee.employeeType}
                options={TYPES.map((v) => ({ value: v, label: t(`types.${v}`) }))}
                disabled={!canEdit}
              />
              <SelectField
                id="status"
                name="status"
                label={c('status')}
                defaultValue={employee.status}
                options={[
                  { value: 'active', label: c('active') },
                  { value: 'inactive', label: c('inactive') },
                ]}
                disabled={!canEdit}
              />
            </FormRow>
            <FormRow columns={2}>
              <InputField
                id="designation"
                name="designation"
                label={t('designation')}
                defaultValue={employee.designation ?? ''}
                disabled={!canEdit}
              />
              <InputField
                id="department"
                name="department"
                label={t('department')}
                defaultValue={employee.department ?? ''}
                disabled={!canEdit}
              />
            </FormRow>
            <FormRow columns={2}>
              <InputField
                id="mobile"
                name="mobile"
                label="Mobile"
                defaultValue={employee.mobile ?? ''}
                pattern="[6-9][0-9]{9}"
                disabled={!canEdit}
              />
              <InputField
                id="email"
                name="email"
                label="Email"
                type="email"
                defaultValue={employee.email ?? ''}
                disabled={!canEdit}
              />
            </FormRow>
            {canEdit ? (
              <FormActions>
                <Button type="submit">{c('save')}</Button>
              </FormActions>
            ) : null}
          </form>
        </Card>
        <Card title={t('posting')}>
          <DataTable<Posting>
            caption={t('posting')}
            density="dense"
            columns={[
              { key: 'year', header: 'Year', render: (x) => x.academicYear },
              { key: 'designation', header: t('designation'), render: (x) => x.designation ?? '' },
              { key: 'department', header: t('department'), render: (x) => x.department ?? '' },
              { key: 'campus', header: t('campus'), render: (x) => x.campus ?? '' },
              { key: 'reportsTo', header: t('reportsTo'), render: (x) => x.reportsTo ?? '' },
              {
                key: 'valid',
                header: 'Valid',
                render: (x) => `${x.validFrom} → ${x.validTo ?? 'open'}`,
              },
            ]}
            rows={employee.postings}
            rowKey={(x) => x.id}
          />
          {canEdit ? (
            <form action={upsertPosting} style={{ marginTop: 'var(--sp-4)' }}>
              <input type="hidden" name="id" value={employee.id} />
              <FormSection title={t('posting')} description={t('postingHelp')}>
                <FormRow columns={2}>
                  <InputField
                    id="p-designation"
                    name="designation"
                    label={t('designation')}
                    defaultValue={employee.posting?.designation ?? employee.designation ?? ''}
                  />
                  <InputField
                    id="p-department"
                    name="department"
                    label={t('department')}
                    defaultValue={employee.posting?.department ?? employee.department ?? ''}
                  />
                </FormRow>
                <FormRow columns={2}>
                  <SelectField
                    id="p-reportsTo"
                    name="reportsToEmployeeId"
                    label={t('reportsTo')}
                    defaultValue={employee.posting?.reportsToEmployeeId ?? ''}
                    options={[
                      { value: '', label: c('none') },
                      ...others.data
                        .filter((e) => e.id !== employee.id)
                        .map((e) => ({
                          value: e.id,
                          label: `${e.displayName} (${e.employeeCode})`,
                        })),
                    ]}
                  />
                  <SelectField
                    id="p-campus"
                    name="campusId"
                    label={t('campus')}
                    defaultValue={employee.posting?.campusId ?? ''}
                    options={[
                      { value: '', label: c('none') },
                      ...(school?.campuses ?? []).map((x) => ({ value: x.id, label: x.name })),
                    ]}
                  />
                </FormRow>
                <FormRow columns={2}>
                  <InputField
                    id="p-from"
                    name="validFrom"
                    label="Valid from"
                    type="date"
                    defaultValue={employee.posting?.validFrom ?? ''}
                  />
                  <InputField
                    id="p-to"
                    name="validTo"
                    label="Valid to"
                    type="date"
                    defaultValue={employee.posting?.validTo ?? ''}
                  />
                </FormRow>
                <FormActions>
                  <Button type="submit" variant="secondary">
                    {c('save')}
                  </Button>
                </FormActions>
              </FormSection>
            </form>
          ) : null}
          {employee.directReports.length > 0 ? (
            <p style={{ marginTop: 'var(--sp-3)' }}>
              <span className="ep-kicker">{t('directReports')}</span>{' '}
              {employee.directReports.map((d, i) => (
                <span key={d.id}>
                  {i > 0 ? ', ' : ''}
                  <a href={`/people/employees/${d.id}`}>{d.displayName}</a>
                </span>
              ))}
            </p>
          ) : null}
        </Card>
        <Card title={p('students.documents')}>
          <DataTable<PersonDocument>
            caption={p('students.documents')}
            density="dense"
            columns={[
              { key: 'kind', header: 'Kind', render: (d) => d.kind },
              { key: 'file', header: 'File', render: (d) => d.fileName ?? d.fileId },
              { key: 'expires', header: 'Expires', render: (d) => d.expiresOn ?? '' },
            ]}
            rows={employee.documents}
            rowKey={(d) => d.id}
            emptyTitle={p('students.noDocuments')}
          />
        </Card>
      </div>
    </>
  );
}
