import { Badge, Card, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ExportWatcher } from '@/components/ExportWatcher';
import { Notice } from '@/components/Notice';
import { LeadList } from '@/components/admissions/LeadList';
import { LeadMove } from '@/components/admissions/LeadMove';
import { dmy } from '@/lib/admission-desk';
import {
  SCORE_LABEL,
  SCORE_TONE,
  type EnquiryList,
  type EnquiryMeta,
  type EnquiryRow,
} from '@/lib/admission-enquiry';
import { exportEnquiriesPdf } from '@/lib/admission-enquiry-actions';
import { apiFetch, getMe } from '@/lib/api';

type Params = {
  view?: string;
  stageId?: string;
  due?: string;
  sourceId?: string;
  classId?: string;
  counsellor?: string;
  score?: string;
  q?: string;
  page?: string;
  ok?: string;
  error?: string;
  detail?: string;
  export?: string;
};
const FILTERS = ['stageId', 'due', 'sourceId', 'classId', 'counsellor', 'score', 'q'] as const;
/** cards a column shows; the rest are a click away in the list */
const PER_COLUMN = 25;

/**
 * Enquiries as lead management (docs/design/45, part 2): today's figures, then the leads as a board (a
 * column per stage of the school's) or a list (filters, pick rows, act on them all), the import of a
 * sheet and the conversion report a click away.
 */
export default async function EnquiriesPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('admissions.enquiry.manage')) notFound();
  const board = sp.view !== 'list';
  const q = new URLSearchParams({
    size: board ? '200' : '50',
    page: String(board ? 1 : Math.max(1, Number(sp.page ?? 1) || 1)),
  });
  for (const k of FILTERS) if (sp[k] && !(board && k === 'stageId')) q.set(k, sp[k]!);
  const [meta, list] = await Promise.all([
    apiFetch<EnquiryMeta>('/admissions/enquiries/meta'),
    apiFetch<EnquiryList>(`/admissions/enquiries?${q.toString()}`),
  ]);
  const stages = (meta.stages ?? []).filter((s) => s.status === 'active');
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const keep = (over: Partial<Params>) => {
    const p = new URLSearchParams();
    for (const k of ['view', ...FILTERS] as const) {
      const v = k in over ? over[k] : sp[k];
      if (v) p.set(k, v);
    }
    const s = p.toString();
    return `/admissions/enquiries${s ? `?${s}` : ''}`;
  };
  const pageHref = (n: number) => {
    const base = keep({});
    return `${base}${base.includes('?') ? '&' : '?'}page=${String(n)}`;
  };
  // the export takes the filters on screen (the stage too in the list); every lead of them, not a page
  const exportFilters: Record<string, string> = {};
  for (const k of FILTERS) if (sp[k] && !(board && k === 'stageId')) exportFilters[k] = sp[k]!;
  if (!board) exportFilters.view = 'list';
  const exportQuery = new URLSearchParams(
    Object.fromEntries(Object.entries(exportFilters).filter(([k]) => k !== 'view')),
  ).toString();
  const tile = (title: string, n: number, help: string, href: string) => (
    <a
      key={title}
      href={href}
      className="ep-tile-link"
      aria-label={`${title}: ${String(n)}. Show them`}
    >
      <Card title={title}>
        <div className="ep-cdash__big">{n}</div>
        <p className="ep-field__help" style={{ margin: 0 }}>
          {help}
        </p>
      </Card>
    </a>
  );
  const late = (e: EnquiryRow) =>
    (e.stage?.kind === 'open' || e.stage?.kind === 'started') &&
    Boolean(e.nextFollowUpOn && e.nextFollowUpOn < today);
  const leadsOf = (stageId: string) =>
    list.data
      .filter((e) => e.stage?.id === stageId)
      .sort(
        (a, b) =>
          Number(late(b)) - Number(late(a)) ||
          (a.nextFollowUpOn ?? '9999').localeCompare(b.nextFollowUpOn ?? '9999'),
      );
  const countOf = (stageId: string) => list.byStage?.find((x) => x.stageId === stageId)?.leads ?? 0;
  return (
    <>
      <PageHeader
        kicker="Admissions"
        title="Enquiries"
        description="Every admission enquiry from the desk, the phone, the website and campaigns, as leads moving through the school's stages to registration and admission."
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/admissions/enquiries/report">
              Conversion report
            </a>
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/admissions/enquiries/import">
              Import
            </a>
            <a className="ep-btn ep-btn--primary ep-btn--sm" href="/admissions/enquiries/new">
              New enquiry
            </a>
          </span>
        }
      />
      <Notice params={sp} />
      {sp.export && /^\d{1,18}$/.test(sp.export) ? (
        <ExportWatcher
          id={sp.export}
          format="pdf"
          labels={{
            queued: 'PDF requested',
            ready: 'Download',
            pending: 'Preparing the PDF…',
            failed: 'The PDF could not be made',
            stuck: 'Still waiting: the workers service makes the files; check that it is running.',
          }}
        />
      ) : null}
      <div className="ep-dash-kpis ep-dash-kpis--4" style={{ marginBottom: 'var(--sp-4)' }}>
        {tile(
          'New, not yet contacted',
          list.counts.new ?? 0,
          `${String(list.counts.mine ?? 0)} open leads are mine`,
          keep({ view: 'list', stageId: stages.find((s) => s.code === 'new')?.id, due: '' }),
        )}
        {tile(
          'Follow-ups today',
          list.counts.dueToday ?? 0,
          'due today',
          keep({ view: 'list', due: 'today' }),
        )}
        {tile(
          'Overdue',
          list.counts.overdue ?? 0,
          'follow-ups past their date',
          keep({ view: 'list', due: 'overdue' }),
        )}
        {tile(
          'Registered this month',
          list.counts.convertedThisMonth ?? 0,
          'leads that became registrations',
          keep({ view: 'list', stageId: stages.find((s) => s.kind === 'registered')?.id, due: '' }),
        )}
      </div>

      <div className="ep-lead-bar">
        <nav className="ep-lead-views" aria-label="View">
          <a href={keep({ view: '' })} aria-current={board ? 'page' : undefined}>
            Board
          </a>
          <a href={keep({ view: 'list' })} aria-current={board ? undefined : 'page'}>
            List
          </a>
        </nav>
        {list.total ? (
          <span className="ep-cdash__export">
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={`/api/admissions/enquiries-list?${exportQuery}`}
              download
            >
              Excel
            </a>
            <form action={exportEnquiriesPdf}>
              {Object.entries(exportFilters).map(([k, v]) => (
                <input key={k} type="hidden" name={k} value={v} />
              ))}
              <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
                PDF
              </button>
            </form>
          </span>
        ) : null}
      </div>

      <Card style={{ marginBottom: 'var(--sp-4)' }}>
        <form method="get" className="ep-lead-filter">
          {board ? null : <input type="hidden" name="view" value="list" />}
          {board ? null : (
            <label className="ep-field">
              <span className="ep-field__label">Stage</span>
              <select className="ep-select" name="stageId" defaultValue={sp.stageId ?? ''}>
                <option value="">Every stage</option>
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="ep-field">
            <span className="ep-field__label">Follow-up</span>
            <select className="ep-select" name="due" defaultValue={sp.due ?? ''}>
              <option value="">Any</option>
              <option value="today">Due today</option>
              <option value="overdue">Overdue</option>
              <option value="upcoming">Later</option>
            </select>
          </label>
          <label className="ep-field">
            <span className="ep-field__label">Source</span>
            <select className="ep-select" name="sourceId" defaultValue={sp.sourceId ?? ''}>
              <option value="">Any</option>
              {meta.sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="ep-field">
            <span className="ep-field__label">Class</span>
            <select className="ep-select" name="classId" defaultValue={sp.classId ?? ''}>
              <option value="">Any</option>
              {meta.classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="ep-field">
            <span className="ep-field__label">Counsellor</span>
            <select className="ep-select" name="counsellor" defaultValue={sp.counsellor ?? ''}>
              <option value="">Anyone</option>
              <option value="me">Me</option>
              <option value="none">Nobody yet</option>
              {meta.counsellors.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
          <label className="ep-field">
            <span className="ep-field__label">Score</span>
            <select className="ep-select" name="score" defaultValue={sp.score ?? ''}>
              <option value="">Any</option>
              <option value="hot">Hot</option>
              <option value="warm">Warm</option>
              <option value="cold">Cold</option>
              <option value="none">Not scored</option>
            </select>
          </label>
          <label className="ep-field">
            <span className="ep-field__label">Search</span>
            <input
              className="ep-input"
              name="q"
              defaultValue={sp.q ?? ''}
              maxLength={80}
              placeholder="Name, mobile, email"
            />
          </label>
          <div>
            <button className="ep-btn ep-btn--primary" type="submit">
              Show
            </button>
          </div>
        </form>
      </Card>

      {board ? (
        <div className="ep-lead-board" tabIndex={0} role="region" aria-label="Leads by stage">
          {/* a stage switched off in set-up still shows while leads are in it */}
          {(meta.stages ?? [])
            .filter((s) => s.status === 'active' || countOf(s.id) > 0)
            .map((s) => {
              const leads = leadsOf(s.id);
              const n = countOf(s.id);
              return (
                <section
                  key={s.id}
                  className="ep-lead-col"
                  aria-labelledby={`col-${s.id}`}
                  data-kind={s.kind}
                >
                  <h2 id={`col-${s.id}`} className="ep-lead-col__h">
                    {s.name} <span className="ep-lead-col__n">{n}</span>
                    {s.status !== 'active' ? (
                      <span className="ep-lead-col__off"> (switched off)</span>
                    ) : null}
                  </h2>
                  <ul className="ep-lead-col__cards">
                    {leads.slice(0, PER_COLUMN).map((e) => (
                      <li key={e.id} className="ep-lead-card" data-late={late(e) || undefined}>
                        <a href={`/admissions/enquiries/${e.id}`} className="ep-lead-card__name">
                          {e.childName || e.parentName}
                        </a>
                        {e.score ? (
                          <Badge tone={SCORE_TONE[e.score]}>{SCORE_LABEL[e.score]}</Badge>
                        ) : null}
                        <span className="ep-lead-card__line">
                          {[e.childName ? e.parentName : null, e.className, e.source]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                        <span className="ep-lead-card__line">
                          {e.counsellor ?? 'Nobody yet'}
                          {e.nextFollowUpOn && (s.kind === 'open' || s.kind === 'started') ? (
                            <>
                              {' · '}
                              {late(e) ? (
                                <Badge tone="danger">{dmy(e.nextFollowUpOn)}</Badge>
                              ) : (
                                dmy(e.nextFollowUpOn)
                              )}
                            </>
                          ) : null}
                        </span>
                        {s.kind === 'open' || (s.kind === 'lost' && !e.registrationNo) ? (
                          <LeadMove
                            id={e.id}
                            name={e.childName || e.parentName}
                            stageId={e.stage?.id ?? null}
                            stages={stages}
                          />
                        ) : e.registrationNo ? (
                          <span className="ep-kicker">{e.registrationNo}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  {n > Math.min(leads.length, PER_COLUMN) ? (
                    <a className="ep-lead-col__more" href={keep({ view: 'list', stageId: s.id })}>
                      All {n} in the list
                    </a>
                  ) : null}
                  {n === 0 ? <p className="ep-field__help">No lead here.</p> : null}
                </section>
              );
            })}
        </div>
      ) : (
        <Card>
          {list.data.length === 0 ? (
            <p style={{ margin: 0 }}>No enquiry matches.</p>
          ) : (
            <LeadList
              rows={list.data}
              stages={stages}
              counsellors={meta.counsellors}
              today={today}
            />
          )}
          <p className="ep-field__help">
            {list.total} enquiries
            {list.total > 50 ? (
              <>
                {' · '}
                {Number(sp.page ?? 1) > 1 ? (
                  <a href={pageHref(Number(sp.page ?? 1) - 1)}>Earlier</a>
                ) : null}{' '}
                {Number(sp.page ?? 1) * 50 < list.total ? (
                  <a href={pageHref(Number(sp.page ?? 1) + 1)}>Next 50</a>
                ) : null}
              </>
            ) : null}
          </p>
        </Card>
      )}
    </>
  );
}
