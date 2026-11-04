import { Badge, Button, Card, DataTable, PageHeader, SelectField } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { AssignmentForm } from '@/components/academics/AssignmentForm';
import { endTeacherAssignment, setAssignmentAreas } from '@/lib/actions';
import { AcademicsNav } from '@/components/academics/AcademicsNav';
import { apiFetch, getMe } from '@/lib/api';
import { sectionOptions } from '@/lib/sections';
import type { Employee, Page, Subject, TeacherAssignment } from '@/lib/types';

const KINDS = ['class_teacher', 'subject_teacher', 'coordinator', 'indicator'] as const;

/** S6-02: teacher assignments; saving one grants the role and section scopes through the database. */
export default async function TeacherAssignmentsPage({
  searchParams,
}: {
  searchParams: Promise<{
    new?: string;
    ok?: string;
    error?: string;
    detail?: string;
    classSectionId?: string;
    employeeId?: string;
    kind?: string;
    includeEnded?: string;
  }>;
}) {
  const sp = await searchParams;
  const adding = sp.new === '1';
  const [t, a, c, me] = await Promise.all([
    getTranslations('pages.academics_teacher_assignments'),
    getTranslations('academics'),
    getTranslations('common'),
    getMe(),
  ]);
  const canManage = me.permissions.includes('academics.teacher_assignment.manage');
  const query = new URLSearchParams();
  if (sp.classSectionId) query.set('classSectionId', sp.classSectionId);
  if (/^\d{1,18}$/.test(sp.employeeId ?? '')) query.set('employeeId', sp.employeeId!);
  const kind = KINDS.find((k) => k === sp.kind) ?? '';
  if (kind) query.set('kind', kind);
  if (sp.includeEnded) query.set('includeEnded', 'true');
  const [assignments, sections, employees, subjects, areas] = await Promise.all([
    apiFetch<{ data: TeacherAssignment[] }>(`/academics/teacher-assignments?${query.toString()}`),
    sectionOptions(),
    apiFetch<Page<Employee>>('/people/employees?size=200&employeeType=teaching')
      .then((r) => r.data)
      .catch(() => [] as Employee[]),
    apiFetch<Page<Subject>>('/academics/subjects?size=200&status=active').then((r) => r.data),
    // the indicator areas an Indicator assignment may name (docs/design/69)
    apiFetch<{ data: Array<{ id: string; name: string; status: string }> }>(
      '/exams/indicator-areas',
    )
      .then((r) => r.data.filter((x) => x.status === 'active'))
      .catch(() => [] as Array<{ id: string; name: string; status: string }>),
  ]);

  return (
    <>
      <PageHeader
        kicker={t('kicker')}
        title={adding ? a('newAssignment') : t('title')}
        description={t('description')}
        actions={
          adding ? (
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href="/academics/teacher-assignments"
            >
              Back to the list
            </a>
          ) : canManage ? (
            <a
              className="ep-btn ep-btn--primary ep-btn--sm"
              href="/academics/teacher-assignments?new=1"
            >
              + Assign a teacher
            </a>
          ) : null
        }
      />
      <AcademicsNav current="/academics/teacher-assignments" permissions={me.permissions} />
      <Notice params={sp} />
      {canManage && adding ? (
        <Card>
          <AssignmentForm
            employees={employees.map((e) => ({
              value: e.id,
              label: `${e.employeeCode} · ${e.displayName}${e.designation ? ` · ${e.designation}` : ''}`,
            }))}
            sections={sections}
            subjects={subjects.map((s) => ({ value: s.id, label: `${s.name} (${s.code})` }))}
          />
        </Card>
      ) : null}
      <div hidden={adding}>
        <Card title={a('assignments')}>
          <form
            method="get"
            style={{
              display: 'flex',
              gap: 'var(--sp-3)',
              alignItems: 'flex-end',
              flexWrap: 'wrap',
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
            <SelectField
              id="employeeId"
              name="employeeId"
              label="Teacher"
              defaultValue={sp.employeeId ?? ''}
              options={[
                { value: '', label: 'All teachers' },
                ...employees.map((e) => ({
                  value: e.id,
                  label: `${e.displayName} (${e.employeeCode})`,
                })),
              ]}
            />
            <SelectField
              id="kind"
              name="kind"
              label={a('assignmentType')}
              defaultValue={kind}
              options={[
                { value: '', label: a('allTypes') },
                ...KINDS.map((k) => ({ value: k, label: a(`assignmentKinds.${k}`) })),
              ]}
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
            <a
              className="ep-btn ep-btn--secondary"
              href={`/api/academics/teacher-assignments-export?format=xlsx&${query.toString()}`}
            >
              Excel
            </a>
            <a
              className="ep-btn ep-btn--secondary"
              href={`/api/academics/teacher-assignments-export?format=pdf&${query.toString()}`}
            >
              PDF
            </a>
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
                    {r.kind === 'class_teacher' && r.isActual === false
                      ? 'Co-class teacher'
                      : a(`assignmentKinds.${r.kind}`)}
                  </Badge>
                ),
              },
              {
                key: 'section',
                header: a('section'),
                render: (r) => `${r.classCode}-${r.section}`,
              },
              {
                key: 'subject',
                header: a('subject'),
                render: (r) =>
                  r.kind === 'indicator' ? (
                    <IndicatorAreas row={r} areas={areas} canManage={canManage && !r.validTo} />
                  ) : r.subjectName ? (
                    `${r.subjectName} (${r.subjectCode})`
                  ) : (
                    ''
                  ),
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
      </div>
    </>
  );
}

/**
 * An Indicator assignment's indicator areas (docs/design/69): the grade registers run "as per mapping"
 * show the teacher only these areas of the section; none ticked covers every area.
 */
function IndicatorAreas({
  row,
  areas,
  canManage,
}: {
  row: TeacherAssignment;
  areas: Array<{ id: string; name: string }>;
  canManage: boolean;
}) {
  const mine = row.indicatorAreas ?? [];
  const text = mine.length ? mine.map((x) => x.name).join(', ') : 'All indicator areas';
  if (!canManage || !areas.length) return <span>{text}</span>;
  return (
    <details className="ep-gr-filter">
      <summary>{text}</summary>
      <form action={setAssignmentAreas} className="ep-streg-form">
        <input type="hidden" name="id" value={row.id} />
        <fieldset className="ep-field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="ep-field__label">
            The areas {row.employeeName} rates in {row.classCode}-{row.section} (none ticked: every
            area)
          </legend>
          <div className="ep-mr-tiles">
            {areas.map((x) => (
              <label key={x.id} className="ep-mr-tile">
                <input
                  type="checkbox"
                  name="areaId"
                  value={x.id}
                  defaultChecked={mine.some((y) => y.id === x.id)}
                />
                <span>{x.name}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <Button type="submit" variant="secondary" size="sm">
            Save areas
          </Button>
        </div>
      </form>
    </details>
  );
}
