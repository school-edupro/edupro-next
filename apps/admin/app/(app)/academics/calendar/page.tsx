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
import { createEvent, createHoliday, deleteEvent, deleteHoliday } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type { AlmanacEvent, Audience, Calendar, Holiday } from '@/lib/types';

const AUDIENCES: Audience[] = ['everyone', 'students', 'employees'];
const HOLIDAY_KINDS = ['holiday', 'vacation', 'working_day'] as const;
const EVENT_KINDS = ['event', 'exam', 'meeting', 'activity', 'deadline'] as const;

/** S7-05: holidays and almanac of the working year. */
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const [t, d, me] = await Promise.all([
    getTranslations('pages.academics_calendar'),
    getTranslations('daily'),
    getMe(),
  ]);
  const canManage = me.permissions.includes('academics.calendar.manage');
  const cal = await apiFetch<Calendar>('/academics/calendar');
  const span = (a: string, b: string) => (a === b ? a : `${a} → ${b}`);

  return (
    <>
      <PageHeader
        kicker={t('kicker')}
        title={t('title')}
        description={`${t('description')} (${cal.from} → ${cal.to})`}
      />
      <Notice params={sp} />
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-5)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))',
        }}
      >
        <Card title={d('holidays')}>
          <DataTable<Holiday>
            caption={d('holidays')}
            density="dense"
            columns={[
              { key: 'dates', header: d('startsOn'), render: (h) => span(h.startsOn, h.endsOn) },
              { key: 'name', header: d('name'), render: (h) => <strong>{h.name}</strong> },
              {
                key: 'kind',
                header: d('kind'),
                render: (h) => (
                  <Badge tone={h.kind === 'working_day' ? 'warning' : 'info'}>
                    {d(`holidayKinds.${h.kind}`)}
                  </Badge>
                ),
              },
              { key: 'who', header: d('appliesTo'), render: (h) => d(`audiences.${h.appliesTo}`) },
              {
                key: 'actions',
                header: '',
                render: (h) =>
                  canManage ? (
                    <form action={deleteHoliday}>
                      <input type="hidden" name="id" value={h.id} />
                      <Button type="submit" variant="ghost" size="sm">
                        {d('delete')}
                      </Button>
                    </form>
                  ) : null,
              },
            ]}
            rows={cal.holidays}
            rowKey={(h) => h.id}
            emptyTitle={d('noHolidays')}
          />
          {canManage ? (
            <form action={createHoliday} style={{ marginTop: 'var(--sp-4)' }}>
              <FormRow columns={2}>
                <InputField id="hname" name="name" label={d('name')} required maxLength={120} />
                <SelectField
                  id="hkind"
                  name="kind"
                  label={d('kind')}
                  options={HOLIDAY_KINDS.map((k) => ({ value: k, label: d(`holidayKinds.${k}`) }))}
                />
              </FormRow>
              <FormRow columns={3}>
                <InputField id="hfrom" name="startsOn" label={d('startsOn')} type="date" required />
                <InputField id="hto" name="endsOn" label={d('endsOn')} type="date" />
                <SelectField
                  id="happlies"
                  name="appliesTo"
                  label={d('appliesTo')}
                  options={AUDIENCES.map((a) => ({ value: a, label: d(`audiences.${a}`) }))}
                />
              </FormRow>
              <FormActions>
                <Button type="submit" variant="secondary">
                  {d('addHoliday')}
                </Button>
              </FormActions>
            </form>
          ) : null}
        </Card>

        <Card title={d('events')}>
          <DataTable<AlmanacEvent>
            caption={d('events')}
            density="dense"
            columns={[
              {
                key: 'dates',
                header: d('startsOn'),
                render: (e) => `${span(e.startsOn, e.endsOn)}${e.startsAt ? ` ${e.startsAt}` : ''}`,
              },
              { key: 'title', header: d('title'), render: (e) => <strong>{e.title}</strong> },
              {
                key: 'kind',
                header: d('kind'),
                render: (e) => (
                  <Badge
                    tone={
                      e.kind === 'exam' ? 'danger' : e.kind === 'deadline' ? 'warning' : 'neutral'
                    }
                  >
                    {d(`eventKinds.${e.kind}`)}
                  </Badge>
                ),
              },
              { key: 'who', header: d('audience'), render: (e) => d(`audiences.${e.audience}`) },
              {
                key: 'actions',
                header: '',
                render: (e) =>
                  canManage ? (
                    <form action={deleteEvent}>
                      <input type="hidden" name="id" value={e.id} />
                      <Button type="submit" variant="ghost" size="sm">
                        {d('delete')}
                      </Button>
                    </form>
                  ) : null,
              },
            ]}
            rows={cal.events}
            rowKey={(e) => e.id}
            emptyTitle={d('noEvents')}
          />
          {canManage ? (
            <form action={createEvent} style={{ marginTop: 'var(--sp-4)' }}>
              <FormRow columns={2}>
                <InputField id="etitle" name="title" label={d('title')} required maxLength={160} />
                <SelectField
                  id="ekind"
                  name="kind"
                  label={d('kind')}
                  options={EVENT_KINDS.map((k) => ({ value: k, label: d(`eventKinds.${k}`) }))}
                />
              </FormRow>
              <FormRow columns={4}>
                <InputField id="efrom" name="startsOn" label={d('startsOn')} type="date" required />
                <InputField id="eto" name="endsOn" label={d('endsOn')} type="date" />
                <InputField id="eat" name="startsAt" label={d('startsAt')} type="time" />
                <SelectField
                  id="eaud"
                  name="audience"
                  label={d('audience')}
                  options={AUDIENCES.map((a) => ({ value: a, label: d(`audiences.${a}`) }))}
                />
              </FormRow>
              <FormRow columns={1}>
                <InputField
                  id="edesc"
                  name="description"
                  label={d('description')}
                  maxLength={2000}
                />
              </FormRow>
              <FormActions>
                <Button type="submit" variant="secondary">
                  {d('addEvent')}
                </Button>
              </FormActions>
            </form>
          ) : null}
        </Card>
      </div>
    </>
  );
}
