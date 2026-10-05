import {
  Badge,
  Button,
  Card,
  DataTable,
  FormActions,
  FormRow,
  InputField,
  PageHeader,
  SelectField,
  toneForStatus,
} from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import {
  createSubject,
  deleteSubject,
  setClassSubjects,
  setSubjectParent,
  setSubjectStatus,
} from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type { ClassRow, ClassSubject, Page, Subject, SubjectKind } from '@/lib/types';

const KINDS: SubjectKind[] = ['scholastic', 'co_scholastic', 'language', 'vocational'];

/** S6-01: subject master and the class-subject mapping of the working year. */
export default async function SubjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string; classId?: string }>;
}) {
  const sp = await searchParams;
  const [t, a, c, me] = await Promise.all([
    getTranslations('pages.academics_subjects'),
    getTranslations('academics'),
    getTranslations('common'),
    getMe(),
  ]);
  const canManage = me.permissions.includes('academics.subject.manage');
  const [subjects, classes, mapped] = await Promise.all([
    apiFetch<Page<Subject>>('/academics/subjects?size=200'),
    apiFetch<Page<ClassRow>>('/academics/classes?size=200'),
    sp.classId
      ? apiFetch<{ data: ClassSubject[] }>(`/academics/classes/${sp.classId}/subjects`).then(
          (r) => r.data,
        )
      : Promise.resolve<ClassSubject[]>([]),
  ]);
  // a subject that is not itself a part can have parts under it
  const parents = subjects.data.filter((x) => !x.parentId && x.status === 'active');
  const mappedById = new Map(mapped.map((m) => [m.subjectId, m]));
  const selectedClass = classes.data.find((k) => k.id === sp.classId);

  return (
    <>
      <PageHeader kicker={t('kicker')} title={t('title')} description={t('description')} />
      <Notice params={sp} />
      <Card title={a('subjects')}>
        <DataTable<Subject>
          caption={a('subjects')}
          density="dense"
          columns={[
            { key: 'code', header: a('code'), render: (s) => <strong>{s.code}</strong> },
            { key: 'name', header: a('name'), render: (s) => s.name },
            { key: 'kind', header: a('kind'), render: (s) => a(`kinds.${s.kind}`) },
            {
              key: 'parent',
              header: 'Part of',
              render: (s) => {
                const hasParts = subjects.data.some((x) => x.parentId === s.id);
                if (hasParts)
                  return (
                    <span className="ep-field__help">
                      {subjects.data
                        .filter((x) => x.parentId === s.id)
                        .map((x) => x.code)
                        .join(', ')}{' '}
                      are part of it
                    </span>
                  );
                if (!canManage) return s.parentCode ?? '—';
                return (
                  <form
                    action={setSubjectParent}
                    style={{ display: 'inline-flex', gap: 'var(--sp-1)' }}
                  >
                    <input type="hidden" name="id" value={s.id} />
                    <select
                      name="parentId"
                      className="ep-select"
                      defaultValue={s.parentId ?? ''}
                      aria-label={`${s.code} is part of`}
                    >
                      <option value="">On its own</option>
                      {parents
                        .filter((p) => p.id !== s.id)
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.code} · {p.name}
                          </option>
                        ))}
                    </select>
                    <Button
                      type="submit"
                      variant="ghost"
                      size="sm"
                      aria-label={`Save what ${s.code} is part of`}
                    >
                      Save
                    </Button>
                  </form>
                );
              },
            },
            { key: 'order', header: a('order'), numeric: true, render: (s) => s.displayOrder },
            {
              key: 'status',
              header: c('status'),
              render: (s) => <Badge tone={toneForStatus(s.status)}>{c(s.status)}</Badge>,
            },
            {
              key: 'actions',
              header: '',
              render: (s) =>
                canManage ? (
                  <span style={{ display: 'inline-flex', gap: 'var(--sp-2)' }}>
                    <form action={setSubjectStatus}>
                      <input type="hidden" name="id" value={s.id} />
                      <input
                        type="hidden"
                        name="status"
                        value={s.status === 'active' ? 'inactive' : 'active'}
                      />
                      <Button type="submit" variant="ghost" size="sm">
                        {s.status === 'active' ? a('deactivate') : a('activate')}
                      </Button>
                    </form>
                    <form action={deleteSubject}>
                      <input type="hidden" name="id" value={s.id} />
                      <Button type="submit" variant="ghost" size="sm">
                        {a('delete')}
                      </Button>
                    </form>
                  </span>
                ) : null,
            },
          ]}
          rows={subjects.data}
          rowKey={(s) => s.id}
          emptyTitle={a('noSubjects')}
        />
      </Card>

      {canManage ? (
        <Card title={a('addSubject')} style={{ marginTop: 'var(--sp-5)' }}>
          <form action={createSubject}>
            <FormRow columns={4}>
              <InputField id="code" name="code" label={a('code')} required maxLength={20} />
              <InputField id="name" name="name" label={a('name')} required maxLength={100} />
              <SelectField
                id="kind"
                name="kind"
                label={a('kind')}
                options={KINDS.map((k) => ({ value: k, label: a(`kinds.${k}`) }))}
              />
              <InputField
                id="displayOrder"
                name="displayOrder"
                label={a('order')}
                type="number"
                min={0}
                defaultValue={subjects.data.length + 1}
              />
              <SelectField
                id="parentId"
                name="parentId"
                label="Part of (for a teaching subject)"
                defaultValue=""
                help="Physics, Chemistry and Biology are part of Science: teachers and daily work use the parts, the report card shows Science."
                options={[
                  { value: '', label: 'On its own' },
                  ...parents.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` })),
                ]}
              />
            </FormRow>
            <FormActions>
              <Button type="submit">{c('create')}</Button>
            </FormActions>
          </form>
        </Card>
      ) : null}

      <Card title={a('classSubjects')} style={{ marginTop: 'var(--sp-5)' }}>
        <p className="ep-field__help" style={{ marginBottom: 'var(--sp-3)' }}>
          {a('classSubjectsHelp')}
        </p>
        <form method="get" style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'flex-end' }}>
          <SelectField
            id="classId"
            name="classId"
            label={a('chooseClass')}
            defaultValue={sp.classId ?? ''}
            options={[
              { value: '', label: c('none') },
              ...classes.data.map((k) => ({ value: k.id, label: `${k.code} · ${k.name}` })),
            ]}
          />
          <Button type="submit" variant="secondary">
            {a('show')}
          </Button>
        </form>
        {selectedClass ? (
          <form action={setClassSubjects} style={{ marginTop: 'var(--sp-4)' }}>
            <input type="hidden" name="classId" value={selectedClass.id} />
            <DataTable<Subject>
              caption={`${selectedClass.name}: ${a('subjects')}`}
              density="dense"
              columns={[
                {
                  key: 'taught',
                  header: a('mapped'),
                  render: (s) => (
                    <input
                      type="checkbox"
                      name="subjectIds"
                      value={s.id}
                      aria-label={`${s.name} ${a('mapped')}`}
                      defaultChecked={mappedById.has(s.id)}
                      disabled={!canManage}
                    />
                  ),
                },
                { key: 'code', header: a('code'), render: (s) => <strong>{s.code}</strong> },
                { key: 'name', header: a('name'), render: (s) => s.name },
                { key: 'kind', header: a('kind'), render: (s) => a(`kinds.${s.kind}`) },
                {
                  key: 'elective',
                  header: a('elective'),
                  render: (s) => (
                    <input
                      type="checkbox"
                      name="elective"
                      value={s.id}
                      aria-label={`${s.name} ${a('elective')}`}
                      defaultChecked={mappedById.get(s.id)?.isElective ?? false}
                      disabled={!canManage}
                    />
                  ),
                },
                {
                  key: 'ppw',
                  header: a('periodsPerWeek'),
                  numeric: true,
                  render: (s) => mappedById.get(s.id)?.periodsPerWeek ?? '',
                },
              ]}
              rows={subjects.data.filter((s) => s.status === 'active' || mappedById.has(s.id))}
              rowKey={(s) => s.id}
              emptyTitle={a('noSubjects')}
            />
            {canManage ? (
              <FormActions>
                <Button type="submit">{a('saveMapping')}</Button>
              </FormActions>
            ) : null}
          </form>
        ) : null}
      </Card>
    </>
  );
}
