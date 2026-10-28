import { Badge, Card, KpiTile, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ResultsGrid } from '@/components/admissions/ResultsGrid';
import { ResultsExports, ResultsPicker } from '@/components/admissions/ResultsPicker';
import { ResultsRelease } from '@/components/admissions/ResultsRelease';
import { ResultsTools } from '@/components/admissions/ResultsTools';
import { whenIst } from '@/lib/admission-process';
import {
  BANDS,
  type ResultsOptions,
  type ResultsOverview,
  type ResultsView,
} from '@/lib/admission-results';
import { apiFetch, getMe } from '@/lib/api';

const okId = (x: string | undefined) => (x && /^\d{1,18}$/.test(x) ? x : undefined);

/**
 * Test results (docs/design/57, part 2), the DPS "Result Report": for a session, class and Test or
 * Interview stage, each candidate with marks by part of the class's paper, total, % and below cut-off;
 * entered on the screen or by the class's sheet (Select / Hold decided with the marks); filtered by
 * slot, name or number, percentage band, cut-off and state; exported as Excel or PDF. With no class
 * chosen, the session's overview (docs/design/58, part 3): each class and stage with candidates,
 * marked, waiting, decided, below cut-off, the paper and the release; the whole session exports.
 */
export default async function ResultsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('admissions.application.view')) notFound();
  const canEdit = me.permissions.includes('admissions.schedule.manage');
  const opts = await apiFetch<ResultsOptions>('/admissions/results/options');
  // the session with candidates at a test or interview first (docs/design/58)
  const cycle =
    opts.cycles.find((y) => y.id === sp.cycleId) ??
    opts.cycles.find((y) => y.candidates > 0) ??
    opts.cycles.find((y) => y.classes.length) ??
    opts.cycles[0];
  // no class: the session's overview
  const cls = cycle?.classes.find((k) => k.id === sp.classId);
  const stage = opts.stages.find((s) => s.id === sp.stageId) ?? opts.stages[0];
  const header = (
    <PageHeader
      kicker="Admissions"
      title="Test results"
      description="The marks of a written test or an interview, subject by subject, for each candidate who reached it. Enter them here or by the class's sheet; the sheet's Decision column selects or holds the candidate. Set the subjects in Admission set-up → Test and interview papers."
    />
  );
  if (!cycle || !stage)
    return (
      <>
        {header}
        <p>
          {!stage
            ? 'No Test or Interview stage is set up (Admission set-up → Stages).'
            : 'No admission session with classes yet.'}
        </p>
      </>
    );
  const picker = (query?: string) => (
    <ResultsPicker opts={opts} cycleId={cycle.id} classId={cls?.id ?? null} stageId={stage.id}>
      <ResultsExports cycleId={cycle.id} query={query} />
    </ResultsPicker>
  );
  if (!cls) {
    const view = await apiFetch<ResultsOverview>(
      `/admissions/results/overview?${new URLSearchParams({ cycleId: cycle.id }).toString()}`,
    );
    const sum = (f: (r: ResultsOverview['rows'][number]) => number | null) =>
      view.rows.reduce((n, r) => n + (f(r) ?? 0), 0);
    const withPaper = view.rows.filter((r) => r.outOf !== null);
    return (
      <>
        {header}
        {picker()}
        <div className="ep-dash-kpis ep-dash-kpis--4" style={{ marginBottom: 'var(--sp-4)' }}>
          <KpiTile label="Candidates" value={cycle.candidates} hint="reached a test or interview" />
          <KpiTile
            label="Marked"
            value={`${String(sum((r) => r.marked))} / ${String(sum((r) => (r.outOf !== null ? r.candidates : 0)))}`}
            hint="marks (or absent) entered"
          />
          <KpiTile
            label="To decide"
            value={sum((r) => r.waiting + r.held)}
            hint={`${String(sum((r) => r.held))} on hold`}
          />
          <KpiTile
            label="No paper"
            value={view.rows.length - withPaper.length}
            hint="class and stage lists without subjects"
          />
        </div>
        <Card elevated title={`Every class · ${view.cycle}`}>
          {view.rows.length ? (
            <div
              className="ep-table-wrap"
              tabIndex={0}
              role="region"
              aria-label="Classes and stages (scrolls sideways)"
            >
              <table className="ep-table ep-table--dense">
                <caption className="ep-sr-only">
                  Each class and stage of {view.cycle}: candidates, marks and decisions
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Class</th>
                    <th scope="col">Stage</th>
                    <th scope="col">Paper</th>
                    <th scope="col" className="ep-num">
                      Candidates
                    </th>
                    <th scope="col">Marked</th>
                    <th scope="col" className="ep-num">
                      Waiting
                    </th>
                    <th scope="col" className="ep-num">
                      Held
                    </th>
                    <th scope="col" className="ep-num">
                      Selected
                    </th>
                    <th scope="col" className="ep-num">
                      Not selected
                    </th>
                    <th scope="col" className="ep-num">
                      Below cut-off
                    </th>
                    <th scope="col">Families see</th>
                    <th scope="col">
                      <span className="ep-sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {view.rows.map((r) => {
                    const open = `/admissions/results?${new URLSearchParams({ cycleId: cycle.id, classId: r.classId, stageId: r.stageId }).toString()}`;
                    const done = r.marked !== null && r.candidates > 0 && r.marked === r.candidates;
                    return (
                      <tr key={`${r.classId}:${r.stageId}`}>
                        <th scope="row">{r.className}</th>
                        <td>{r.stage}</td>
                        <td>
                          {r.outOf !== null ? (
                            `out of ${String(r.outOf)}`
                          ) : (
                            <>
                              <Badge tone="warning">No paper</Badge>{' '}
                              <a
                                href={`/admissions/setup/papers?stage=${r.stageId}&class=${r.classId}`}
                              >
                                Set it<span className="ep-sr-only"> for {r.className}</span>
                              </a>
                            </>
                          )}
                        </td>
                        <td className="ep-num">{r.candidates}</td>
                        <td>
                          {r.marked === null ? (
                            '-'
                          ) : (
                            <>
                              {r.marked} of {r.candidates}{' '}
                              {done ? <Badge tone="success">Done</Badge> : null}
                            </>
                          )}
                        </td>
                        <td className="ep-num">{r.waiting}</td>
                        <td className="ep-num">{r.held}</td>
                        <td className="ep-num">{r.selected}</td>
                        <td className="ep-num">{r.rejected}</td>
                        <td className="ep-num">{r.below ?? '-'}</td>
                        <td>
                          {r.release ? (
                            r.release.passed ? (
                              <Badge tone="success">Out</Badge>
                            ) : (
                              `From ${whenIst(r.release.at)}`
                            )
                          ) : (
                            '-'
                          )}
                        </td>
                        <td>
                          <a className="ep-btn ep-btn--ghost ep-btn--sm" href={open}>
                            Open
                            <span className="ep-sr-only">
                              {' '}
                              {r.className} {r.stage}
                            </span>
                          </a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p style={{ margin: 0 }}>
              No candidate of {view.cycle} has reached a test or interview yet.
            </p>
          )}
        </Card>
      </>
    );
  }
  const filters: Record<string, string> = {};
  if (okId(sp.slotId)) filters.slotId = sp.slotId!;
  const search = (sp.q ?? '').trim().slice(0, 80);
  if (search) filters.q = search;
  if (BANDS.includes(sp.band ?? '')) filters.band = sp.band!;
  if (sp.cutoff === 'below' || sp.cutoff === 'ok') filters.cutoff = sp.cutoff;
  if (['waiting', 'decided', 'unmarked'].includes(sp.state ?? '')) filters.state = sp.state!;
  const place = { cycleId: cycle.id, classId: cls.id, stageId: stage.id };
  const query = new URLSearchParams({ ...place, ...filters }).toString();
  const data = await apiFetch<ResultsView>(`/admissions/results?${query}`);
  const paper = data.place.paper;
  const isTest = data.place.kind === 'test';
  const figures: Array<[string, number, string]> = [
    ['Candidates', data.counts.all, `at ${data.place.stage} or past it`],
    ['Waiting', data.counts.waiting, 'for a decision here'],
    ['Marked', data.counts.marked, 'marks (or absent) entered'],
    ['Below cut-off', data.counts.below, 'a pass mark or the minimum %'],
  ];
  return (
    <>
      {header}
      {picker(query)}
      <form method="get" className="ep-card ep-lead-filter" style={{ marginBottom: 'var(--sp-4)' }}>
        <input type="hidden" name="cycleId" value={cycle.id} />
        <input type="hidden" name="classId" value={cls.id} />
        <input type="hidden" name="stageId" value={stage.id} />
        {data.slots.length ? (
          <label className="ep-field">
            <span className="ep-field__label">Slot</span>
            <select name="slotId" className="ep-select" defaultValue={filters.slotId ?? ''}>
              <option value="">Every slot</option>
              {data.slots.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="ep-field">
          <span className="ep-field__label">Name or registration no.</span>
          <input name="q" className="ep-input" defaultValue={search} />
        </label>
        <label className="ep-field">
          <span className="ep-field__label">Percentage</span>
          <select name="band" className="ep-select" defaultValue={filters.band ?? ''}>
            <option value="">All</option>
            {BANDS.map((b) => (
              <option key={b} value={b}>
                {b}%
              </option>
            ))}
          </select>
        </label>
        <label className="ep-field">
          <span className="ep-field__label">Cut-off</span>
          <select name="cutoff" className="ep-select" defaultValue={filters.cutoff ?? ''}>
            <option value="">All</option>
            <option value="below">Below cut-off</option>
            <option value="ok">At or above</option>
          </select>
        </label>
        <label className="ep-field">
          <span className="ep-field__label">Stands</span>
          <select name="state" className="ep-select" defaultValue={filters.state ?? ''}>
            <option value="">All</option>
            <option value="waiting">Waiting (or held)</option>
            <option value="decided">Decided</option>
            <option value="unmarked">No marks yet</option>
          </select>
        </label>
        <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', alignItems: 'flex-end' }}>
          <button type="submit" className="ep-btn ep-btn--primary">
            Show
          </button>
          <a
            className="ep-btn ep-btn--ghost"
            href={`/admissions/results?${new URLSearchParams(place).toString()}`}
          >
            Clear
          </a>
        </span>
      </form>
      {!paper ? (
        <p className="ep-alert ep-alert--info" role="status">
          <span>
            {data.place.className} has no paper for {data.place.stage}: set its{' '}
            {isTest ? 'subjects' : 'parameters'} in{' '}
            <a href={`/admissions/setup/papers?stage=${stage.id}&class=${cls.id}`}>
              Admission set-up → Test and interview papers
            </a>
            , then mark them here.
          </span>
        </p>
      ) : (
        <>
          <div className="ep-dash-kpis ep-dash-kpis--4" style={{ marginBottom: 'var(--sp-4)' }}>
            {figures.map(([label, n, help]) => (
              <KpiTile key={label} label={label} value={n} hint={help} />
            ))}
          </div>
          <ResultsRelease
            place={place}
            release={data.release}
            log={data.releaseLog ?? []}
            marked={data.counts.marked}
            canEdit={canEdit}
          />
          <ResultsTools place={place} query={query} canEdit={canEdit} exports={false} />
          <ResultsGrid
            place={place}
            paper={paper}
            kind={data.place.kind}
            rows={data.rows}
            canEdit={canEdit}
            heading={`${data.place.stage} · ${data.place.className} · ${data.place.cycle} · out of ${String(paper.total)}`}
          />
        </>
      )}
    </>
  );
}
