import {
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
import { clearSlot, createPeriod, deletePeriod, setSlot } from '@/lib/actions';
import { AcademicsNav } from '@/components/academics/AcademicsNav';
import { apiFetch, getMe } from '@/lib/api';
import { sectionOptions } from '@/lib/sections';
import type { Employee, Page, Period, PeriodKind, Slot, Subject } from '@/lib/types';

const PERIOD_KINDS: PeriodKind[] = ['teaching', 'break', 'assembly', 'activity'];
const WEEKDAYS = [1, 2, 3, 4, 5, 6];

/** S6-03: periods and the weekly timetable grid of one section; the API refuses double-booked teachers. */
export default async function TimetablePage({
  searchParams,
}: {
  searchParams: Promise<{
    ok?: string;
    error?: string;
    detail?: string;
    classSectionId?: string;
    weekday?: string;
    periodId?: string;
  }>;
}) {
  const sp = await searchParams;
  const [t, a, c, me] = await Promise.all([
    getTranslations('pages.academics_timetable'),
    getTranslations('academics'),
    getTranslations('common'),
    getMe(),
  ]);
  const canManage = me.permissions.includes('academics.timetable.manage');
  const [periods, sections, slots, subjects, employees] = await Promise.all([
    apiFetch<{ data: Period[] }>('/academics/timetable/periods').then((r) => r.data),
    sectionOptions(),
    sp.classSectionId
      ? apiFetch<{ data: Slot[] }>(
          `/academics/timetable/slots?classSectionId=${sp.classSectionId}`,
        ).then((r) => r.data)
      : Promise.resolve<Slot[]>([]),
    apiFetch<Page<Subject>>('/academics/subjects?size=200&status=active').then((r) => r.data),
    canManage
      ? apiFetch<Page<Employee>>('/people/employees?size=200&employeeType=teaching').then(
          (r) => r.data,
        )
      : Promise.resolve<Employee[]>([]),
  ]);
  const section = sections.find((s) => s.value === sp.classSectionId);
  const slotAt = new Map(slots.map((s) => [`${s.weekday}:${s.periodId}`, s]));
  const teachingPeriods = periods.filter((p) => p.kind === 'teaching');
  const base = `/academics/timetable?classSectionId=${sp.classSectionId ?? ''}`;

  return (
    <>
      <PageHeader kicker={t('kicker')} title={t('title')} description={t('description')} />
      <AcademicsNav current="/academics/timetable" permissions={me.permissions} />
      <Notice params={sp} />

      <Card>
        <form method="get" style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'flex-end' }}>
          <SelectField
            id="classSectionId"
            name="classSectionId"
            label={a('chooseSection')}
            defaultValue={sp.classSectionId ?? ''}
            options={[{ value: '', label: c('none') }, ...sections]}
          />
          <Button type="submit" variant="secondary">
            {a('show')}
          </Button>
        </form>
        {section ? (
          <div style={{ marginTop: 'var(--sp-4)' }}>
            <DataTable<Period>
              caption={a('week', { section: section.label })}
              density="dense"
              columns={[
                {
                  key: 'period',
                  header: a('period'),
                  render: (p) => (
                    <span>
                      <strong>{p.name}</strong>
                      <br />
                      <span className="ep-kicker">
                        {p.startsAt}–{p.endsAt}
                      </span>
                    </span>
                  ),
                },
                ...WEEKDAYS.map((d) => ({
                  key: `d${d}`,
                  header: a(`weekdays.${d}`),
                  render: (p: Period) => {
                    if (p.kind !== 'teaching')
                      return <span className="ep-kicker">{a(`periodKinds.${p.kind}`)}</span>;
                    const slot = slotAt.get(`${d}:${p.id}`);
                    const href = `${base}&weekday=${d}&periodId=${p.id}#set-slot`;
                    return (
                      <span
                        style={{ display: 'inline-flex', gap: 'var(--sp-1)', alignItems: 'center' }}
                      >
                        <a href={href} title={slot?.room ?? ''}>
                          {slot ? (
                            <span>
                              <strong>{slot.subjectCode ?? '—'}</strong>
                              <br />
                              <span
                                style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-small)' }}
                              >
                                {slot.employeeName ?? ''}
                              </span>
                            </span>
                          ) : (
                            <span className="ep-kicker">{a('free')}</span>
                          )}
                        </a>
                        {slot && canManage ? (
                          <form action={clearSlot}>
                            <input type="hidden" name="id" value={slot.id} />
                            <input type="hidden" name="classSectionId" value={sp.classSectionId} />
                            <Button type="submit" variant="ghost" size="sm" aria-label={a('clear')}>
                              ×
                            </Button>
                          </form>
                        ) : null}
                      </span>
                    );
                  },
                })),
              ]}
              rows={periods}
              rowKey={(p) => p.id}
              emptyTitle={a('noPeriods')}
            />
          </div>
        ) : null}
      </Card>

      {section && canManage ? (
        <Card title={a('setSlot')} style={{ marginTop: 'var(--sp-5)' }} id="set-slot">
          <p className="ep-field__help" style={{ marginBottom: 'var(--sp-3)' }}>
            {a('setSlotHelp')}
          </p>
          <form action={setSlot}>
            <input type="hidden" name="classSectionId" value={sp.classSectionId} />
            <FormRow columns={4}>
              <SelectField
                id="weekday"
                name="weekday"
                label={a('weekday')}
                defaultValue={sp.weekday ?? '1'}
                options={WEEKDAYS.map((d) => ({ value: String(d), label: a(`weekdays.${d}`) }))}
              />
              <SelectField
                id="periodId"
                name="periodId"
                label={a('period')}
                defaultValue={sp.periodId ?? teachingPeriods[0]?.id ?? ''}
                options={teachingPeriods.map((p) => ({
                  value: p.id,
                  label: `${p.name} (${p.startsAt}–${p.endsAt})`,
                }))}
              />
              <SelectField
                id="subjectId"
                name="subjectId"
                label={a('subject')}
                options={[
                  { value: '', label: a('none') },
                  ...subjects.map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` })),
                ]}
              />
              <SelectField
                id="employeeId"
                name="employeeId"
                label={a('teacher')}
                options={[
                  { value: '', label: a('none') },
                  ...employees.map((e) => ({ value: e.id, label: e.displayName })),
                ]}
              />
              <InputField id="room" name="room" label={a('room')} maxLength={40} />
            </FormRow>
            <FormActions>
              <Button type="submit">{a('save')}</Button>
            </FormActions>
          </form>
        </Card>
      ) : null}

      <Card title={a('periods')} style={{ marginTop: 'var(--sp-5)' }}>
        <DataTable<Period>
          caption={a('periods')}
          density="dense"
          columns={[
            { key: 'number', header: a('number'), numeric: true, render: (p) => p.number },
            { key: 'name', header: a('name'), render: (p) => p.name },
            { key: 'starts', header: a('startsAt'), render: (p) => p.startsAt },
            { key: 'ends', header: a('endsAt'), render: (p) => p.endsAt },
            { key: 'kind', header: a('periodKind'), render: (p) => a(`periodKinds.${p.kind}`) },
            {
              key: 'actions',
              header: '',
              render: (p) =>
                canManage ? (
                  <form action={deletePeriod}>
                    <input type="hidden" name="id" value={p.id} />
                    <Button type="submit" variant="ghost" size="sm">
                      {a('delete')}
                    </Button>
                  </form>
                ) : null,
            },
          ]}
          rows={periods}
          rowKey={(p) => p.id}
          emptyTitle={a('noPeriods')}
        />
        {canManage ? (
          <form action={createPeriod} style={{ marginTop: 'var(--sp-4)' }}>
            <FormRow columns={4}>
              <InputField
                id="number"
                name="number"
                label={a('number')}
                type="number"
                min={1}
                max={20}
                required
                defaultValue={periods.length + 1}
              />
              <InputField id="pname" name="name" label={a('name')} required maxLength={40} />
              <InputField
                id="startsAt"
                name="startsAt"
                label={a('startsAt')}
                type="time"
                required
              />
              <InputField id="endsAt" name="endsAt" label={a('endsAt')} type="time" required />
              <SelectField
                id="pkind"
                name="kind"
                label={a('periodKind')}
                options={PERIOD_KINDS.map((k) => ({ value: k, label: a(`periodKinds.${k}`) }))}
              />
            </FormRow>
            <FormActions>
              <Button type="submit" variant="secondary">
                {a('addPeriod')}
              </Button>
            </FormActions>
          </form>
        ) : null}
      </Card>
    </>
  );
}
