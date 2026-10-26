import { Badge, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import {
  DEFAULT_REGISTRATIONS_VIEW,
  sanitizeAdmissionView,
  type AdmissionListFields,
  type AdmissionListResult,
} from '@/lib/admission-list';
import type { ProcessSetup } from '@/lib/admission-process';
import { apiFetch, getMe } from '@/lib/api';

const PER_BAND = 40;
const COLUMNS = [
  'class_sought',
  'session',
  'stage',
  'level',
  'level_name',
  'deciders',
  'days_waiting',
  'overdue',
];

type Row = AdmissionListResult['rows'][number];

/**
 * The registrations board (docs/design/47, part 3): a column per stage, a band per level inside, a card
 * per registration waiting there (candidate, class, days waiting, who decides; overdue in red). The
 * filters and search of the registrations list apply; Waiting for me or everyone in process.
 */
export default async function RegistrationsBoardPage({
  searchParams,
}: {
  searchParams: Promise<{ mine?: string }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('admissions.application.view')) notFound();
  const mine = sp.mine === '1';
  const [fields, saved, setup] = await Promise.all([
    apiFetch<AdmissionListFields>('/admissions/registrations/grid/fields'),
    apiFetch<{ value: unknown }>('/me/preferences/admissions.registrations').catch(() => ({
      value: null,
    })),
    apiFetch<ProcessSetup>('/admissions/process-setup'),
  ]);
  const view = sanitizeAdmissionView(
    saved.value,
    new Set(fields.fields.map((f) => f.key)),
    DEFAULT_REGISTRATIONS_VIEW,
  );
  const data = await apiFetch<AdmissionListResult>('/admissions/registrations/grid', {
    method: 'POST',
    body: JSON.stringify({
      columns: COLUMNS.map((key) => ({ key })),
      filters: view.filters,
      sort: [{ key: 'days_waiting', dir: 'desc' }],
      search: view.search || undefined,
      status: mine ? 'mine' : 'in_progress',
      includeAll: Boolean(view.includeAll),
      scope: 'registrations',
      page: 1,
      size: 200,
    }),
  });
  const waiting = data.rows.filter((r) => r.stage);
  const names = [
    ...setup.stages.map((s) => s.name),
    ...new Set(
      waiting.map((r) => String(r.stage)).filter((n) => !setup.stages.some((s) => s.name === n)),
    ),
  ];
  const kindOf = new Map(setup.stages.map((s) => [s.name, s.kind]));
  const bands = (stage: string) => {
    const m = new Map<string, Row[]>();
    for (const r of waiting.filter((x) => x.stage === stage)) {
      // the level's name; "level 1 of 2" only where the stage has more than one level
      const of = String(r.level ?? '');
      const key = [
        r.level_name ? String(r.level_name) : '',
        of && !of.endsWith(' of 1') ? `level ${of}` : '',
      ]
        .filter(Boolean)
        .join(' · ');
      m.set(key, [...(m.get(key) ?? []), r]);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  };
  const filtered = view.filters.length + (view.search ? 1 : 0);
  return (
    <>
      <PageHeader
        kicker="Admissions"
        title="Registrations board"
        description="Each registration waiting for a decision, by stage and level. Open a card to decide."
      />
      <div className="ep-lead-bar">
        <nav className="ep-lead-views" aria-label="View">
          <a href={`/admissions/registrations${mine ? '?tab=mine' : '?tab=in_progress'}`}>List</a>
          <a href={`/admissions/registrations/board${mine ? '?mine=1' : ''}`} aria-current="page">
            Board
          </a>
        </nav>
        <nav className="ep-lead-views" aria-label="Whose">
          <a href="/admissions/registrations/board?mine=1" aria-current={mine ? 'page' : undefined}>
            Waiting for me ({data.stats.mine})
          </a>
          <a href="/admissions/registrations/board" aria-current={mine ? undefined : 'page'}>
            Everyone in process ({data.stats.in_progress})
          </a>
        </nav>
      </div>
      <p className="ep-field__help">
        {waiting.length} waiting at a stage
        {data.total > waiting.length
          ? ` · ${String(data.total - waiting.length)} more in the view are not waiting at a stage (selected, offered, on the list): see the list`
          : ''}
        {data.total > data.rows.length ? ` · the first ${String(data.rows.length)} are shown` : ''}
        {filtered
          ? ` · the list's ${String(filtered)} filter${filtered === 1 ? '' : 's'} apply`
          : ''}
      </p>
      {waiting.length === 0 ? (
        <p className="ep-card" style={{ margin: 0 }}>
          {mine ? 'Nothing waits for your decision.' : 'No registration waits at a stage.'}
        </p>
      ) : (
        <div
          className="ep-lead-board"
          tabIndex={0}
          role="region"
          aria-label="Registrations by stage"
        >
          {names.map((stage, i) => {
            const groups = bands(stage);
            const n = groups.reduce((t, [, rows]) => t + rows.length, 0);
            return (
              <section
                key={stage}
                className="ep-lead-col"
                aria-labelledby={`rcol-${String(i)}`}
                data-kind={kindOf.get(stage) === 'selection' ? 'registered' : undefined}
              >
                <h2 id={`rcol-${String(i)}`} className="ep-lead-col__h">
                  {stage} <span className="ep-lead-col__n">{n}</span>
                </h2>
                {groups.map(([band, rows]) => (
                  <div key={band || 'one'} style={{ display: 'grid', gap: 'var(--sp-2)' }}>
                    {band ? (
                      <h3 className="ep-kicker" style={{ margin: 0 }}>
                        {band}
                      </h3>
                    ) : null}
                    <ul className="ep-lead-col__cards">
                      {rows.slice(0, PER_BAND).map((r) => (
                        <li
                          key={String(r.__id)}
                          className="ep-lead-card"
                          data-late={r.overdue === 'Yes' || undefined}
                        >
                          <a
                            href={`/admissions/registrations/${String(r.__id)}`}
                            className="ep-lead-card__name"
                          >
                            {String(r.candidate ?? r.registration_no ?? 'Registration')}
                          </a>
                          {r.overdue === 'Yes' ? <Badge tone="danger">Overdue</Badge> : null}
                          <span className="ep-lead-card__line">
                            {[r.registration_no, r.class_sought].filter(Boolean).join(' · ')}
                          </span>
                          <span className="ep-lead-card__line">
                            {r.days_waiting === null || r.days_waiting === undefined
                              ? ''
                              : Number(r.days_waiting) === 0
                                ? 'Since today'
                                : `${String(r.days_waiting)} day${Number(r.days_waiting) === 1 ? '' : 's'} waiting`}
                            {r.deciders ? ` · ${String(r.deciders)}` : ''}
                          </span>
                        </li>
                      ))}
                    </ul>
                    {rows.length > PER_BAND ? (
                      <a className="ep-lead-col__more" href="/admissions/registrations">
                        {rows.length - PER_BAND} more in the list
                      </a>
                    ) : null}
                  </div>
                ))}
                {!groups.length ? <p className="ep-lead-card__line">None waiting</p> : null}
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
