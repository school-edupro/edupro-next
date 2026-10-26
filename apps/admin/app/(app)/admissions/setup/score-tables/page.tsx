import { PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ScoreTablesEditor } from '@/components/admissions/ScoreTablesEditor';
import { TABLE_TITLE, type ScoreTableName, type ScoreTables } from '@/lib/admission-scores';
import { apiFetch, getMe } from '@/lib/api';

const TABS: ScoreTableName[] = ['qualification', 'locality', 'alumni_school'];

/**
 * The school's merit score tables (docs/design/48, part 1): qualifications, localities and alumni
 * schools with their scores, read by the sessions' merit criteria "from a table".
 */
export default async function ScoreTablesPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('admissions.cycle.view')) notFound();
  const t: ScoreTableName = TABS.includes(sp.t as ScoreTableName)
    ? (sp.t as ScoreTableName)
    : 'qualification';
  const data = await apiFetch<ScoreTables>('/admissions/score-tables');
  return (
    <>
      <PageHeader
        kicker="Admission set-up"
        title="Merit score tables"
        description="The tables a session's merit criteria read: a qualification's points for the father and the mother, a locality's distance points, an alumni school's points by pass-out class. Set the criteria on the session's Merit points tab."
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/admissions/setup">
            Admission set-up
          </a>
        }
      />
      <nav
        className="ep-lead-views"
        aria-label="Score tables"
        style={{ marginBottom: 'var(--sp-3)' }}
      >
        {TABS.map((x) => (
          <a
            key={x}
            href={`/admissions/setup/score-tables?t=${x}`}
            aria-current={x === t ? 'page' : undefined}
          >
            {TABLE_TITLE[x]} ({data[x].length})
          </a>
        ))}
      </nav>
      <ScoreTablesEditor
        key={t}
        table={t}
        initial={data[t]}
        classes={data.classes}
        options={data.options}
        canEdit={me.permissions.includes('admissions.setup.manage')}
      />
    </>
  );
}
