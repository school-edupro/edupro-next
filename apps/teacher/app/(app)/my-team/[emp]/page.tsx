import { Badge, Card, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { bff } from '@/lib/bff';
import { dmy } from '@/lib/leave';

interface Team {
  monthWords: string;
  rows: Array<{
    employee: { id: string; name: string; code: string };
    cells: Array<{ day: string; code: string; title: string; late?: boolean; missing?: boolean }>;
  }>;
}
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral' | 'info'> = {
  P: 'success',
  HD: 'warning',
  A: 'danger',
  LOP: 'danger',
  HOLD: 'danger',
  WO: 'neutral',
  H: 'neutral',
};

/** One team member's month, day by day (docs/design/85, "my reportees' attendance"). */
export default async function TeamMemberPage({
  params,
  searchParams,
}: {
  params: Promise<{ emp: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const { emp } = await params;
  const sp = await searchParams;
  if (!/^\d{1,18}$/.test(emp)) notFound();
  const month = sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : '';
  const d = await bff.api.fetch<Team>(
    `/staff-attendance/team?employeeId=${emp}${month ? `&month=${month}` : ''}`,
  );
  const r = d.rows[0];
  if (!r) notFound();
  return (
    <>
      <PageHeader kicker={`${r.employee.code} · ${d.monthWords}`} title={r.employee.name} />
      <Card>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {r.cells
            .filter((c) => c.code)
            .map((c) => (
              <li
                key={c.day}
                style={{
                  padding: 'var(--sp-2) 0',
                  borderBottom: '1px solid var(--border-default)',
                }}
              >
                <strong>
                  {WEEKDAY[new Date(`${c.day}T00:00:00Z`).getUTCDay()]} {dmy(c.day)}
                </strong>{' '}
                <Badge tone={TONE[c.code.replace('½', '')] ?? 'info'}>
                  {c.code === '·' ? 'Not marked' : c.code}
                </Badge>
                {c.late ? <Badge tone="warning">Late</Badge> : null}{' '}
                {c.missing ? <Badge tone="warning">Punch missing</Badge> : null}
                {c.title ? (
                  <div className="ep-field__help" style={{ margin: 0 }}>
                    {c.title}
                  </div>
                ) : null}
              </li>
            ))}
        </ul>
      </Card>
      <p>
        <a href={`/my-team${month ? `?month=${month}` : ''}`}>Back to my team</a>
      </p>
    </>
  );
}
