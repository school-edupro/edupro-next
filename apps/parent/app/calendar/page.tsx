import { Badge, Card, DataTable, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

interface Holiday {
  id: string;
  name: string;
  kind: string;
  startsOn: string;
  endsOn: string;
}
interface Event {
  id: string;
  title: string;
  kind: string;
  startsOn: string;
  endsOn: string;
  startsAt: string | null;
}
interface Calendar {
  holidays: Holiday[];
  events: Event[];
  from: string;
  to: string;
}

type Entry = {
  key: string;
  date: string;
  end: string;
  label: string;
  kind: string;
  at: string | null;
  holiday: boolean;
};

/** S7-08: holidays and almanac in one list, upcoming first. */
export default async function CalendarPage() {
  let cal: Calendar;
  try {
    cal = await bff.api.fetch<Calendar>('/academics/calendar');
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && error.status === 403)
      return (
        <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
          <PageHeader kicker="EduPro" title="Calendar" />
          <Card>The calendar is not available for this account.</Card>
        </main>
      );
    throw error;
  }
  const today = new Date().toISOString().slice(0, 10);
  const entries: Entry[] = [
    ...cal.holidays.map((h) => ({
      key: `h${h.id}`,
      date: h.startsOn,
      end: h.endsOn,
      label: h.name,
      kind: h.kind,
      at: null,
      holiday: true,
    })),
    ...cal.events.map((e) => ({
      key: `e${e.id}`,
      date: e.startsOn,
      end: e.endsOn,
      label: e.title,
      kind: e.kind,
      at: e.startsAt,
      holiday: false,
    })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  const upcoming = entries.filter((e) => e.end >= today);
  const past = entries.filter((e) => e.end < today);
  const span = (a: string, b: string) => (a === b ? a : `${a} → ${b}`);
  const table = (rows: Entry[], caption: string) => (
    <DataTable<Entry>
      caption={caption}
      density="dense"
      columns={[
        {
          key: 'date',
          header: 'Date',
          render: (e) => `${span(e.date, e.end)}${e.at ? ` ${e.at}` : ''}`,
        },
        { key: 'label', header: 'What', render: (e) => <strong>{e.label}</strong> },
        {
          key: 'kind',
          header: 'Kind',
          render: (e) => (
            <Badge tone={e.holiday ? 'success' : e.kind === 'exam' ? 'danger' : 'neutral'}>
              {e.kind.replace('_', ' ')}
            </Badge>
          ),
        },
      ]}
      rows={rows}
      rowKey={(e) => e.key}
      emptyTitle="Nothing scheduled"
    />
  );
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
      <PageHeader
        kicker="Calendar"
        title="Holidays and almanac"
        description={`${cal.from} → ${cal.to}`}
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/">
            Home
          </a>
        }
      />
      <Card title="Upcoming" style={{ marginBottom: 'var(--sp-4)' }}>
        {table(upcoming, 'Upcoming')}
      </Card>
      <Card title="Earlier this year">{table(past, 'Earlier this year')}</Card>
    </main>
  );
}
