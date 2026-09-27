import { Button, Card, InputField, PageHeader, SelectField } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { StudentsGrid } from '@/components/StudentsGrid';
import { apiFetch, getMe } from '@/lib/api';
import type { ClassRow, Page, SectionRow, Student } from '@/lib/types';

export async function sectionOptions(): Promise<Array<{ value: string; label: string }>> {
  const classes = await apiFetch<Page<ClassRow>>('/academics/classes?size=200').catch(() => ({
    data: [] as ClassRow[],
    page: { number: 1, size: 0, total: 0 },
  }));
  const all = await Promise.all(
    classes.data.map((c) =>
      apiFetch<{ data: SectionRow[] }>(`/academics/classes/${c.id}/sections`)
        .then((r) => r.data.map((s) => ({ value: s.id, label: `${c.code}-${s.name}` })))
        .catch(() => []),
    ),
  );
  return all.flat();
}

export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<{
    ok?: string;
    error?: string;
    detail?: string;
    q?: string;
    classSectionId?: string;
    status?: string;
  }>;
}) {
  const sp = await searchParams;
  const [t, c, me] = await Promise.all([
    getTranslations('people.students'),
    getTranslations('common'),
    getMe(),
  ]);
  const params = new URLSearchParams({ size: '200' });
  if (sp.q) params.set('q', sp.q);
  if (sp.classSectionId) params.set('classSectionId', sp.classSectionId);
  if (sp.status) params.set('status', sp.status);
  const [students, sections] = await Promise.all([
    apiFetch<Page<Student>>(`/people/students?${params.toString()}`),
    sectionOptions(),
  ]);
  const canCreate = me.permissions.includes('people.student.create');
  return (
    <>
      <PageHeader
        kicker={(await getTranslations('people'))('kicker')}
        title={t('title')}
        description={t('description')}
        actions={
          canCreate ? (
            <a className="ep-btn ep-btn--primary" href="/people/students/new">
              {t('new')}
            </a>
          ) : null
        }
      />
      <Notice params={sp} />
      <div className="ep-filter-band">
        <form
          method="get"
          style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'flex-end', flexWrap: 'wrap' }}
        >
          <InputField id="q" name="q" label={t('search')} defaultValue={sp.q ?? ''} />
          <SelectField
            id="classSectionId"
            name="classSectionId"
            label={t('section')}
            defaultValue={sp.classSectionId ?? ''}
            options={[{ value: '', label: c('all') }, ...sections]}
          />
          <SelectField
            id="status"
            name="status"
            label={c('status')}
            defaultValue={sp.status ?? ''}
            options={[
              { value: '', label: c('all') },
              { value: 'active', label: c('active') },
              { value: 'inactive', label: c('inactive') },
            ]}
          />
          <Button type="submit" variant="secondary">
            {c('filter')}
          </Button>
        </form>
      </div>
      <Card>
        <StudentsGrid rows={students.data} />
      </Card>
    </>
  );
}
