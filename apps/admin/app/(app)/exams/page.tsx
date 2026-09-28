import {
  Badge,
  Button,
  Card,
  Checkbox,
  DataTable,
  FormActions,
  FormRow,
  InputField,
  PageHeader,
  SelectField,
} from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { createExam } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type { ClassRow, Exam, ExamType, GradeScale, Page } from '@/lib/types';

/** Sprint 14: exams of the working year. */
export default async function ExamsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const [t, x, me, exams, types, scales, classes] = await Promise.all([
    getTranslations('pages.exams_list'),
    getTranslations('exams'),
    getMe(),
    apiFetch<{ data: Exam[] }>('/exams').then((r) => r.data),
    apiFetch<{ data: ExamType[] }>('/exams/types').then((r) =>
      r.data.filter((t) => t.status === 'active'),
    ),
    apiFetch<{ data: GradeScale[] }>('/exams/grade-scales').then((r) => r.data),
    apiFetch<Page<ClassRow>>('/academics/classes?size=200').then((r) => r.data),
  ]);
  const canManage = me.permissions.includes('exams.master.manage');
  return (
    <>
      <PageHeader kicker={t('kicker')} title={t('title')} description={t('description')} />
      <Notice params={sp} />
      <Card title={t('title')}>
        <DataTable<Exam>
          caption={t('title')}
          density="dense"
          columns={[
            { key: 'code', header: x('code'), render: (e) => <strong>{e.code}</strong> },
            { key: 'name', header: x('name'), render: (e) => e.name },
            { key: 'type', header: x('type'), render: (e) => e.examTypeName },
            { key: 'from', header: x('startsOn'), render: (e) => e.startsOn ?? '—' },
            { key: 'to', header: x('endsOn'), render: (e) => e.endsOn ?? '—' },
            {
              key: 'classes',
              header: x('classes'),
              render: (e) => e.classes.map((k) => `${k.classCode} (${k.subjects})`).join(', '),
            },
            {
              key: 'flags',
              header: x('status'),
              render: (e) => (
                <span style={{ display: 'inline-flex', gap: 'var(--sp-1)' }}>
                  {e.showOnPortal ? <Badge tone="info">{x('portal')}</Badge> : null}
                  {e.marksLocked ? <Badge tone="warning">{x('locked')}</Badge> : null}
                  {e.status === 'inactive' ? <Badge tone="neutral">{e.status}</Badge> : null}
                </span>
              ),
            },
            {
              key: 'open',
              header: '',
              render: (e) => (
                <a className="ep-btn ep-btn--ghost ep-btn--sm" href={`/exams/${e.id}`}>
                  {x('open')}
                </a>
              ),
            },
          ]}
          rows={exams}
          rowKey={(e) => e.id}
          emptyTitle={x('noExams')}
        />
        {canManage && types.length ? (
          <form action={createExam} style={{ marginTop: 'var(--sp-4)' }}>
            <FormRow columns={4}>
              <SelectField
                id="examTypeId"
                name="examTypeId"
                label={x('type')}
                options={types.map((t) => ({ value: t.id, label: `${t.code} · ${t.name}` }))}
              />
              <InputField
                id="code"
                name="code"
                label={x('code')}
                required
                pattern="[A-Za-z0-9_-]{2,20}"
              />
              <InputField id="name" name="name" label={x('name')} required maxLength={120} />
              <SelectField
                id="gradeScaleId"
                name="gradeScaleId"
                label={x('gradeScale')}
                options={[
                  { value: '', label: '—' },
                  ...scales.map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` })),
                ]}
              />
            </FormRow>
            <FormRow columns={3}>
              <InputField id="startsOn" name="startsOn" label={x('startsOn')} type="date" />
              <InputField id="endsOn" name="endsOn" label={x('endsOn')} type="date" />
              <Checkbox id="showOnPortal" name="showOnPortal" label={x('portal')} />
            </FormRow>
            <fieldset style={{ border: 0, padding: 0, margin: 'var(--sp-2) 0' }}>
              <legend className="ep-field__label">{x('classes')}</legend>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-2) var(--sp-4)' }}>
                {classes.map((k) => (
                  <Checkbox
                    key={k.id}
                    id={`cls-${k.id}`}
                    name="classId"
                    value={k.id}
                    label={k.code}
                  />
                ))}
              </div>
            </fieldset>
            <FormActions>
              <Button type="submit">{x('addExam')}</Button>
            </FormActions>
          </form>
        ) : null}
      </Card>
    </>
  );
}
