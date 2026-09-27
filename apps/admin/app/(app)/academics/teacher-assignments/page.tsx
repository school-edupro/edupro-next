import {
  Badge,
  Button,
  Card,
  DataTable,
  FormActions,
  FormRow,
  PageHeader,
  SelectField,
} from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { createTeacherAssignment, endTeacherAssignment } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import { sectionOptions } from '@/lib/sections';
import type { AssignmentKind, Employee, Page, Subject, TeacherAssignment } from '@/lib/types';

const KINDS: AssignmentKind[] = ['class_teacher', 'subject_teacher', 'coordinator', 'indicator'];

/** S6-02: teacher assignments; saving one grants the role and section scopes through the database. */
export default async function TeacherAssignmentsPage({
  searchParams,
}: {
  searchParams: Promise<{
    ok?: string;
    error?: string;
    detail?: string;
    classSectionId?: string;
    includeEnded?: string;
  }>;
}) {
  const sp = await searchParams;
  const [t, a, c, me] = await Promise.all([
    getTranslations('pages.academics_teacher_assignments'),
    getTranslations('academics'),
    getTranslations('common'),
    getMe(),
  ]);
  const canManage = me.permissions.includes('academics.teacher_assignment.manage');
  const query = new URLSearchParams();
  if (sp.classSectionId) query.set('classSectionId', sp.classSectionId);
  if (sp.includeEnded) query.set('includeEnded', 'true');
  const [assignments, sections, employees, subjects] = await Promise.all([
    apiFetch<{ data: TeacherAssignment[] }>(`/academics/teacher-assignments?${query.toString()}`),
    sectionOptions(),
    canManage
      ? apiFetch<Page<Employee>>('/people/employees?size=200&employeeType=teaching').then(
          (r) => r.data,
        )
      : Promise.resolve<Employee[]>([]),
    apiFetch<Page<Subject>>('/academics/subjects?size=200&status=active').then((r) => r.data),
  ]);

  return (
    <>
      <PageHeader kicker={t('kicker')} title={t('title')} description={t('description')} />
      <Notice params={sp} />
      <Card>
        <form
          method="get"
          style={{
            display: 'flex',
            gap: 'var(--sp-3)',
            alignItems: 'flex-end',
            marginBottom: 'var(--sp-4)',
          }}
        >
          <SelectField
            id="classSectionId"
            name="classSectionId"
            label={a('section')}
            defaultValue={sp.classSectionId ?? ''}
            options={[{ value: '', label: a('allSections') }, ...sections]}
          />
          <label style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
            <input
              type="checkbox"
              name="includeEnded"
              value="1"
              defaultChecked={!!sp.includeEnded}
            />
            {a('ended')}
          </label>
          <Button type="submit" variant="secondary">
            {c('filter')}
          </Button>
        </form>
        <DataTable<TeacherAssignment>
          caption={a('assignments')}
          density="dense"
          columns={[
            {
              key: 'employee',
              header: a('employee'),
              render: (r) => (
                <a href={`/people/employees/${r.employeeId}`}>
                  {r.employeeName} <span className="ep-kicker">{r.employeeCode}</span>
                </a>
              ),
            },
            {
              key: 'kind',
              header: a('assignmentKind'),
              render: (r) => (
                <Badge tone={r.kind === 'class_teacher' ? 'info' : 'neutral'}>
                  {a(`assignmentKinds.${r.kind}`)}
                </Badge>
              ),
            },
            { key: 'section', header: a('section'), render: (r) => `${r.classCode}-${r.section}` },
            {
              key: 'subject',
              header: a('subject'),
              render: (r) => (r.subjectName ? `${r.subjectName} (${r.subjectCode})` : ''),
            },
            { key: 'since', header: a('since'), render: (r) => r.validFrom },
            {
              key: 'status',
              header: c('status'),
              render: (r) => (
                <Badge tone={r.validTo ? 'neutral' : 'success'}>
                  {r.validTo ? `${a('ended')} ${r.validTo}` : a('active')}
                </Badge>
              ),
            },
            {
              key: 'actions',
              header: '',
              render: (r) =>
                canManage && !r.validTo ? (
                  <form action={endTeacherAssignment}>
                    <input type="hidden" name="id" value={r.id} />
                    <Button type="submit" variant="ghost" size="sm">
                      {a('end')}
                    </Button>
                  </form>
                ) : null,
            },
          ]}
          rows={assignments.data}
          rowKey={(r) => r.id}
          emptyTitle={a('noAssignments')}
        />
      </Card>

      {canManage ? (
        <Card title={a('newAssignment')} style={{ marginTop: 'var(--sp-5)' }}>
          <p className="ep-field__help" style={{ marginBottom: 'var(--sp-3)' }}>
            {a('newAssignmentHelp')}
          </p>
          <form action={createTeacherAssignment}>
            <FormRow columns={4}>
              <SelectField
                id="employeeId"
                name="employeeId"
                label={a('employee')}
                required
                options={employees.map((e) => ({
                  value: e.id,
                  label: `${e.displayName} · ${e.designation ?? e.employeeCode}`,
                }))}
              />
              <SelectField
                id="kind"
                name="kind"
                label={a('assignmentKind')}
                options={KINDS.map((k) => ({ value: k, label: a(`assignmentKinds.${k}`) }))}
              />
              <SelectField
                id="newSection"
                name="classSectionId"
                label={a('section')}
                required
                defaultValue={sp.classSectionId ?? ''}
                options={sections}
              />
              <SelectField
                id="subjectId"
                name="subjectId"
                label={a('subject')}
                options={[
                  { value: '', label: c('none') },
                  ...subjects.map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` })),
                ]}
              />
            </FormRow>
            <FormRow columns={3}>
              {(['canMarkAttendance', 'canPostHomework', 'canAnswerQueries'] as const).map((f) => (
                <label
                  key={f}
                  style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}
                >
                  <input type="checkbox" name={f} value="1" defaultChecked />
                  {a(f)}
                </label>
              ))}
            </FormRow>
            <FormActions>
              <Button type="submit">{a('assign')}</Button>
            </FormActions>
          </form>
        </Card>
      ) : null}
    </>
  );
}
