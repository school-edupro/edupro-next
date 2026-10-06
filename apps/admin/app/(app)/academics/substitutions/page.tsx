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
} from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { createSubstitution, removeSubstitution } from '@/lib/actions';
import { AcademicsNav } from '@/components/academics/AcademicsNav';
import { apiFetch, getMe } from '@/lib/api';
import { sectionOptions } from '@/lib/sections';
import type { FreeTeacher, Substitution } from '@/lib/types';

interface Period {
  id: string;
  number: number;
  name: string;
  kind: string;
}
const today = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

export default async function SubstitutionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    ok?: string;
    error?: string;
    detail?: string;
    date?: string;
    classSectionId?: string;
    periodId?: string;
  }>;
}) {
  const sp = await searchParams;
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today();
  const [t, pl, me, subs, sections, periods] = await Promise.all([
    getTranslations('pages.academics_substitutions'),
    getTranslations('planner'),
    getMe(),
    apiFetch<{ data: Substitution[] }>(`/academics/substitutions?date=${date}`).then((r) => r.data),
    sectionOptions(),
    apiFetch<{ data: Period[] }>('/academics/timetable/periods').then((r) =>
      r.data.filter((p) => p.kind === 'teaching'),
    ),
  ]);
  const canManage = me.permissions.includes('academics.substitution.manage');
  const free =
    canManage && sp.periodId
      ? await apiFetch<{ data: FreeTeacher[] }>(
          `/academics/substitutions/free-teachers?date=${date}&periodId=${sp.periodId}`,
        ).then((r) => r.data)
      : [];
  return (
    <>
      <PageHeader kicker={t('kicker')} title={t('title')} description={t('description')} />
      <AcademicsNav current="/academics/substitutions" permissions={me.permissions} />
      <Notice params={sp} />
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-5)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 560px), 1fr))',
        }}
      >
        <Card title={`${pl('date')} ${date}`}>
          <form
            method="get"
            style={{
              display: 'flex',
              gap: 'var(--sp-3)',
              alignItems: 'flex-end',
              marginBottom: 'var(--sp-3)',
            }}
          >
            <InputField id="date" name="date" label={pl('date')} type="date" defaultValue={date} />
            <Button type="submit" variant="secondary">
              {pl('date')}
            </Button>
          </form>
          <DataTable<Substitution>
            caption={t('title')}
            density="dense"
            columns={[
              { key: 'period', header: pl('period'), render: (s) => s.periodName },
              {
                key: 'section',
                header: pl('section'),
                render: (s) => <strong>{s.section}</strong>,
              },
              { key: 'subject', header: pl('subject'), render: (s) => s.subject ?? '' },
              { key: 'absent', header: pl('absent'), render: (s) => s.absentTeacher ?? '—' },
              {
                key: 'sub',
                header: pl('substitute'),
                render: (s) => <Badge tone="info">{s.substitute}</Badge>,
              },
              { key: 'reason', header: pl('reason'), render: (s) => s.reason ?? '' },
              ...(canManage
                ? [
                    {
                      key: 'remove',
                      header: '',
                      render: (s: Substitution) => (
                        <form action={removeSubstitution}>
                          <input type="hidden" name="id" value={s.id} />
                          <input type="hidden" name="onDate" value={date} />
                          <Button type="submit" variant="ghost" size="sm">
                            {pl('remove')}
                          </Button>
                        </form>
                      ),
                    },
                  ]
                : []),
            ]}
            rows={subs}
            rowKey={(s) => s.id}
            emptyTitle={pl('noSubstitutions')}
          />
        </Card>
        {canManage ? (
          <Card title={pl('assign')}>
            <form
              method="get"
              style={{
                display: 'flex',
                gap: 'var(--sp-3)',
                alignItems: 'flex-end',
                flexWrap: 'wrap',
                marginBottom: 'var(--sp-3)',
              }}
            >
              <input type="hidden" name="date" value={date} />
              <SelectField
                id="classSectionId"
                name="classSectionId"
                label={pl('section')}
                defaultValue={sp.classSectionId ?? ''}
                options={[{ value: '', label: '—' }, ...sections]}
              />
              <SelectField
                id="periodId"
                name="periodId"
                label={pl('period')}
                defaultValue={sp.periodId ?? ''}
                options={[
                  { value: '', label: '—' },
                  ...periods.map((p) => ({ value: p.id, label: p.name })),
                ]}
              />
              <Button type="submit" variant="secondary">
                {pl('free')}
              </Button>
            </form>
            {!sp.periodId ? <p className="ep-field__help">{pl('pick')}</p> : null}
            {sp.periodId && sp.classSectionId ? (
              <form action={createSubstitution}>
                <input type="hidden" name="onDate" value={date} />
                <input type="hidden" name="classSectionId" value={sp.classSectionId} />
                <input type="hidden" name="periodId" value={sp.periodId} />
                <FormRow columns={2}>
                  <SelectField
                    id="substituteEmployeeId"
                    name="substituteEmployeeId"
                    label={pl('substitute')}
                    options={free.map((f) => ({
                      value: f.id,
                      label: `${f.name} · ${f.load} ${pl('load').toLowerCase()}`,
                    }))}
                  />
                  <InputField id="reason" name="reason" label={pl('reason')} maxLength={200} />
                </FormRow>
                <FormActions>
                  <Button type="submit">{pl('assign')}</Button>
                </FormActions>
              </form>
            ) : null}
          </Card>
        ) : null}
      </div>
    </>
  );
}
