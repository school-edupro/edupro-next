import { Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { ChildSwitch } from '@/components/ChildSwitch';
import { chosenChild } from '@/lib/child';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';

interface Viewer {
  students: Array<{
    id: string;
    name: string;
    classSectionId: string | null;
    section: string | null;
  }>;
}
interface Period {
  id: string;
  number: number;
  name: string;
  startsAt: string;
  endsAt: string;
  isBreak: boolean;
}
interface Slot {
  weekday: number;
  periodId: string;
  subjectName: string | null;
  teacherName: string | null;
  room: string | null;
}
const DAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** S10: the child's weekly timetable. */
export default async function TimetablePage({
  searchParams,
}: {
  searchParams: Promise<{ child?: string }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  let viewer: Viewer;
  try {
    viewer = await bff.api.fetch<Viewer>('/academics/daily-work/viewer');
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && error.status === 403)
      return (
        <main style={{ padding: 'var(--sp-4)', maxWidth: 900, margin: '0 auto' }}>
          <PageHeader kicker="EduPro" title={t(lang, 'Timetable')} />
          <Card>
            {t(
              lang,
              'Your account is not linked to a student yet. Please contact the school office.',
            )}
          </Card>
        </main>
      );
    throw error;
  }
  const kids = viewer.students.filter((s) => s.classSectionId);
  const chosen = await chosenChild(sp.child);
  const child = kids.find((k) => k.id === chosen?.id) ?? kids[0];
  const [periods, slots] = child
    ? await Promise.all([
        bff.api.fetch<{ data: Period[] }>('/academics/timetable/periods').then((r) => r.data),
        bff.api
          .fetch<{ data: Slot[] }>(
            `/academics/timetable/slots?classSectionId=${child.classSectionId}`,
          )
          .then((r) => r.data),
      ])
    : [[], []];
  const at = (day: number, periodId: string) =>
    slots.find((s) => s.weekday === day && s.periodId === periodId);
  const days = [1, 2, 3, 4, 5, 6].filter((d) => slots.some((s) => s.weekday === d));
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 900, margin: '0 auto' }}>
      <PageHeader
        kicker={t(lang, 'Timetable')}
        title={child ? `${child.name} · ${child.section}` : t(lang, 'Timetable')}
        description={
          child
            ? `${days.length} ${t(lang, 'school days a week')}`
            : t(lang, 'No enrolled child found')
        }
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)' }}>
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/">
              {t(lang, 'Home')}
            </a>
          </span>
        }
      />
      <ChildSwitch lang={lang} back="/timetable" current={child?.id} />
      <Card>
        {slots.length === 0 ? (
          <p className="ep-field__help">{t(lang, 'The timetable has not been published yet.')}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="ep-table ep-table--dense">
              <thead>
                <tr>
                  <th>{t(lang, 'Period')}</th>
                  {days.map((d) => (
                    <th key={d}>{t(lang, DAYS[d] ?? '')}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {periods.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <strong>{p.name}</strong>
                      <div className="ep-kicker">
                        {p.startsAt.slice(0, 5)}–{p.endsAt.slice(0, 5)}
                      </div>
                    </td>
                    {days.map((d) => {
                      const s = at(d, p.id);
                      return (
                        <td key={d} style={{ opacity: p.isBreak ? 0.6 : 1 }}>
                          {p.isBreak ? (
                            '—'
                          ) : s ? (
                            <>
                              {s.subjectName}
                              <div className="ep-kicker">
                                {s.teacherName ?? ''}
                                {s.room ? ` · ${s.room}` : ''}
                              </div>
                            </>
                          ) : (
                            ''
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </main>
  );
}
