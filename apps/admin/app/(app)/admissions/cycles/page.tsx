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
import { createAdmissionCycle, updateAdmissionCycle } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type { AdmissionCycle, ClassRow, Page, Year } from '@/lib/types';

const RULES = [
  '',
  'sibling',
  'staff_ward',
  'alumni',
  'single_girl_child',
  'distance_within:5',
  'distance_within:10',
];

/** S8-03: admission cycles with criteria and scoring masters. */
export default async function CyclesPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const [t, a, c, me] = await Promise.all([
    getTranslations('pages.admissions_cycles'),
    getTranslations('admissions'),
    getTranslations('common'),
    getMe(),
  ]);
  const canManage = me.permissions.includes('admissions.cycle.manage');
  const [cycles, classes, years] = await Promise.all([
    apiFetch<{ data: AdmissionCycle[] }>('/admissions/cycles').then((r) => r.data),
    apiFetch<Page<ClassRow>>('/academics/classes?size=200').then((r) => r.data),
    apiFetch<{ data: Year[] }>('/platform/years')
      .then((r) => r.data.filter((y) => y.kind === 'academic' && y.status !== 'closed'))
      .catch(() => [] as Year[]),
  ]);
  const local = (iso: string) =>
    new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
  return (
    <>
      <PageHeader kicker={t('kicker')} title={t('title')} description={t('description')} />
      <Notice params={sp} />
      <Card>
        <DataTable<AdmissionCycle>
          caption={t('title')}
          density="dense"
          columns={[
            {
              key: 'code',
              header: a('code'),
              render: (x) => <a href={`/admissions/cycles/${x.id}`}>{x.code}</a>,
            },
            { key: 'name', header: a('name'), render: (x) => x.name },
            { key: 'session', header: a('session'), render: (x) => x.academicYear },
            {
              key: 'window',
              header: a('opensAt'),
              render: (x) =>
                `${new Date(x.opensAt).toLocaleDateString('en-IN')} → ${new Date(x.closesAt).toLocaleDateString('en-IN')}`,
            },
            {
              key: 'classes',
              header: a('class'),
              render: (x) => x.criteria.map((k) => `${k.classCode} (${k.seats})`).join(', '),
            },
            {
              key: 'apps',
              header: a('applications'),
              numeric: true,
              render: (x) => x.applications,
            },
            {
              key: 'status',
              header: a('status'),
              render: (x) => (
                <Badge
                  tone={
                    x.status === 'open' ? 'success' : x.status === 'closed' ? 'neutral' : 'warning'
                  }
                >
                  {a(`statuses.${x.status}`)}
                </Badge>
              ),
            },
            {
              key: 'actions',
              header: '',
              render: (x) =>
                canManage ? (
                  <form action={updateAdmissionCycle}>
                    <input type="hidden" name="id" value={x.id} />
                    <input
                      type="hidden"
                      name="status"
                      value={x.status === 'open' ? 'closed' : 'open'}
                    />
                    <Button type="submit" variant="ghost" size="sm">
                      {x.status === 'open'
                        ? a('close')
                        : x.status === 'closed'
                          ? a('reopen')
                          : a('open')}
                    </Button>
                  </form>
                ) : null,
            },
          ]}
          rows={cycles}
          rowKey={(x) => x.id}
          emptyTitle={a('noCycles')}
        />
      </Card>
      {canManage ? (
        <Card title={a('newCycle')} style={{ marginTop: 'var(--sp-5)' }}>
          <form action={createAdmissionCycle}>
            <FormRow columns={4}>
              <InputField
                id="code"
                name="code"
                label={a('code')}
                required
                pattern="[A-Za-z0-9-]{2,20}"
              />
              <InputField id="name" name="name" label={a('name')} required maxLength={120} />
              <InputField id="nameHi" name="nameHi" label={a('nameHi')} maxLength={120} />
              <SelectField
                id="academicYearId"
                name="academicYearId"
                label={a('session')}
                required
                options={years.map((y) => ({ value: y.id, label: `${y.code} (${y.status})` }))}
              />
            </FormRow>
            <FormRow columns={3}>
              <InputField
                id="opensAt"
                name="opensAt"
                label={a('opensAt')}
                type="datetime-local"
                required
                defaultValue={local(new Date().toISOString())}
              />
              <InputField
                id="closesAt"
                name="closesAt"
                label={a('closesAt')}
                type="datetime-local"
                required
                defaultValue={local(new Date(Date.now() + 30 * 86_400_000).toISOString())}
              />
              <InputField
                id="applicationFee"
                name="applicationFee"
                label={a('applicationFee')}
                type="number"
                min={0}
                step="1"
                defaultValue={0}
              />
            </FormRow>
            <FormRow columns={2}>
              <InputField
                id="instructions"
                name="instructions"
                label={a('instructions')}
                maxLength={5000}
              />
              <InputField
                id="instructionsHi"
                name="instructionsHi"
                label={a('instructionsHi')}
                maxLength={5000}
              />
            </FormRow>
            <p className="ep-field__help" style={{ marginTop: 'var(--sp-3)' }}>
              <strong>{a('criteria')}</strong>
            </p>
            {[0, 1, 2, 3].map((i) => (
              <FormRow key={i} columns={4}>
                <SelectField
                  id={`crit-class-${i}`}
                  name="criteriaClassId"
                  label={a('class')}
                  options={[
                    { value: '', label: c('none') },
                    ...classes.map((k) => ({ value: k.id, label: k.code })),
                  ]}
                />
                <InputField
                  id={`crit-seats-${i}`}
                  name="criteriaSeats"
                  label={a('seats')}
                  type="number"
                  min={0}
                  defaultValue={40}
                />
                <InputField
                  id={`crit-from-${i}`}
                  name="criteriaDobFrom"
                  label={a('dobFrom')}
                  type="date"
                />
                <InputField
                  id={`crit-to-${i}`}
                  name="criteriaDobTo"
                  label={a('dobTo')}
                  type="date"
                />
                <input type="hidden" name="criteriaPasscode" value="" />
              </FormRow>
            ))}
            <p className="ep-field__help" style={{ marginTop: 'var(--sp-3)' }}>
              <strong>{a('scoring')}</strong>
            </p>
            {[
              ['sibling', 'Sibling in school', 20, 'sibling'],
              ['staff_ward', 'Ward of staff', 25, 'staff_ward'],
              ['alumni', 'Alumni parent', 10, 'alumni'],
              ['distance', 'Within 5 km', 15, 'distance_within:5'],
              ['interview', 'Interaction', 30, ''],
            ].map(([code, name, points, rule], i) => (
              <FormRow key={i} columns={4}>
                <InputField
                  id={`sc-code-${i}`}
                  name="scoreCode"
                  label={a('code')}
                  defaultValue={String(code)}
                  pattern="[a-z0-9_]*"
                />
                <InputField
                  id={`sc-name-${i}`}
                  name="scoreName"
                  label={a('name')}
                  defaultValue={String(name)}
                />
                <InputField
                  id={`sc-points-${i}`}
                  name="scorePoints"
                  label={a('points')}
                  type="number"
                  min={0}
                  defaultValue={Number(points)}
                />
                <SelectField
                  id={`sc-rule-${i}`}
                  name="scoreRule"
                  label={a('autoRule')}
                  defaultValue={String(rule)}
                  options={RULES.map((r) => ({ value: r, label: r || a('manual') }))}
                />
              </FormRow>
            ))}
            <p className="ep-field__help">{a('formHelp')}</p>
            <FormActions>
              <Button type="submit">{c('create')}</Button>
            </FormActions>
          </form>
        </Card>
      ) : null}
    </>
  );
}
