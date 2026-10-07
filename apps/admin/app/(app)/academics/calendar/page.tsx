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
import { createEvent, deleteEvent } from '@/lib/actions';
import { AcademicsNav } from '@/components/academics/AcademicsNav';
import { apiFetch, getMe } from '@/lib/api';
import type { AlmanacEvent, Audience, Calendar, Holiday } from '@/lib/types';

const AUDIENCES: Audience[] = ['everyone', 'students', 'employees'];
const EVENT_KINDS = ['event', 'exam', 'meeting', 'activity', 'deadline'] as const;

/** S7-05: holidays and almanac of the working year. */
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string; new?: string }>;
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
      <AcademicsNav current="/academics/calendar" permissions={me.permissions} />
      <Notice params={sp} />
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-5)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 560px), 1fr))',
        }}
      >
        <Card
          title={d('holidays')}
          actions={
            canManage ? (
              <a
                className="ep-btn ep-btn--secondary ep-btn--sm"
                href="/masters/academics?tab=holidays"
              >
                Manage in Setup
              </a>
            ) : null
          }
        >
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
            ]}
            rows={cal.holidays}
            rowKey={(h) => h.id}
            emptyTitle={d('noHolidays')}
          />
          <p className="ep-field__help" style={{ marginBottom: 0 }}>
            Holidays are added, corrected and uploaded by Excel in Academics → Setup → Holidays.
          </p>
        </Card>

        <Card
          title={d('events')}
          actions={
            canManage ? (
              <a
                className="ep-btn ep-btn--secondary ep-btn--sm"
                href="/academics/calendar?new=event"
              >
                + Event
              </a>
            ) : null
          }
        >
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
          {canManage && sp.new === 'event' ? (
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
