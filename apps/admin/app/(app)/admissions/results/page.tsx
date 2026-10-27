import { KpiTile, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ResultsGrid } from '@/components/admissions/ResultsGrid';
import { ResultsRelease } from '@/components/admissions/ResultsRelease';
import { ResultsTools } from '@/components/admissions/ResultsTools';
import { BANDS, type ResultsOptions, type ResultsView } from '@/lib/admission-results';
import { apiFetch, getMe } from '@/lib/api';

const okId = (x: string | undefined) => (x && /^\d{1,18}$/.test(x) ? x : undefined);

/**
 * Test results (docs/design/57, part 2), the DPS "Result Report": for a session, class and Test or
 * Interview stage, each candidate with marks by part of the class's paper, total, % and below cut-off;
 * entered on the screen or by the class's sheet (Select / Hold decided with the marks); filtered by
 * slot, name or number, percentage band, cut-off and state; exported as Excel or PDF.
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
  const cycle =
    opts.cycles.find((y) => y.id === sp.cycleId) ??
    opts.cycles.find((y) => y.classes.length) ??
    opts.cycles[0];
  const cls = cycle?.classes.find((k) => k.id === sp.classId) ?? cycle?.classes[0];
  const stage = opts.stages.find((s) => s.id === sp.stageId) ?? opts.stages[0];
  const header = (
    <PageHeader
      kicker="Admissions"
      title="Test results"
      description="The marks of a written test or an interview, subject by subject, for each candidate who reached it. Enter them here or by the class's sheet; the sheet's Decision column selects or holds the candidate. Set the subjects in Admission set-up → Test and interview papers."
    />
  );
  if (!cycle || !cls || !stage)
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
      <form method="get" className="ep-card ep-lead-filter" style={{ marginBottom: 'var(--sp-4)' }}>
        <label className="ep-field">
          <span className="ep-field__label">Session</span>
          <select name="cycleId" className="ep-select" defaultValue={cycle.id}>
            {opts.cycles.map((y) => (
              <option key={y.id} value={y.id}>
                {y.name}
              </option>
            ))}
          </select>
        </label>
        <label className="ep-field">
          <span className="ep-field__label">Class</span>
          <select name="classId" className="ep-select" defaultValue={cls.id}>
            {cycle.classes.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
          </select>
        </label>
        <label className="ep-field">
          <span className="ep-field__label">Stage</span>
          <select name="stageId" className="ep-select" defaultValue={stage.id}>
            {opts.stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
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
            marked={data.counts.marked}
            canEdit={canEdit}
          />
          <ResultsTools place={place} query={query} canEdit={canEdit} />
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
