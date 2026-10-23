import { Badge, Card, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { dmy } from '@/lib/admission-desk';
import { ENQUIRY_STATUS, type EnquiryMeta, type EnquiryRow } from '@/lib/admission-enquiry';
import { apiFetch, getMe } from '@/lib/api';

/**
 * The enquiry desk (docs/design/39, part 8): what is due today and overdue first, then every enquiry
 * filtered by status, follow-up, source, class and counsellor.
 */
export default async function EnquiriesPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    due?: string;
    sourceId?: string;
    classId?: string;
    counsellor?: string;
    q?: string;
    page?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('admissions.enquiry.manage')) notFound();
  const q = new URLSearchParams({
    size: '50',
    page: String(Math.max(1, Number(sp.page ?? 1) || 1)),
  });
  for (const k of ['status', 'due', 'sourceId', 'classId', 'counsellor', 'q'] as const)
    if (sp[k]) q.set(k, sp[k]!);
  if (!sp.status && !sp.due && !sp.q) q.set('status', 'open');
  const [meta, list] = await Promise.all([
    apiFetch<EnquiryMeta>('/admissions/enquiries/meta'),
    apiFetch<{ total: number; counts: Record<string, number>; data: EnquiryRow[] }>(
      `/admissions/enquiries?${q.toString()}`,
    ),
  ]);
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
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
  return (
    <>
      <PageHeader
        kicker="Admissions"
        title="Enquiries"
        description="Every admission enquiry from the desk, the phone and the website, with the next follow-up. Invite interested families to register: their form starts with what they told you."
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/admissions/enquiries/report">
              Conversion report
            </a>
            <a className="ep-btn ep-btn--primary ep-btn--sm" href="/admissions/enquiries/new">
              New enquiry
            </a>
          </span>
        }
      />
      <Notice params={sp} />
      <div className="ep-dash-kpis ep-dash-kpis--4" style={{ marginBottom: 'var(--sp-4)' }}>
        {tile(
          'Due today',
          list.counts.dueToday ?? 0,
          'follow-ups for today',
          '/admissions/enquiries?due=today',
        )}
        {tile(
          'Overdue',
          list.counts.overdue ?? 0,
          'follow-ups past their date',
          '/admissions/enquiries?due=overdue',
        )}
        {tile(
          'Open',
          list.counts.open ?? 0,
          `${String(list.counts.new ?? 0)} new · ${String(list.counts.mine ?? 0)} mine`,
          '/admissions/enquiries?status=open',
        )}
        {tile(
          'Registered this month',
          list.counts.convertedThisMonth ?? 0,
          'enquiries that became registrations',
          '/admissions/enquiries?status=converted',
        )}
      </div>
      <Card style={{ marginBottom: 'var(--sp-4)' }}>
        <form
          method="get"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 170px), 1fr))',
            gap: 'var(--sp-3)',
            alignItems: 'end',
          }}
        >
          <label className="ep-field">
            <span className="ep-field__label">Status</span>
            <select className="ep-select" name="status" defaultValue={sp.status ?? 'open'}>
              <option value="open">Open</option>
              {Object.entries(ENQUIRY_STATUS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>
          </label>
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
            <span className="ep-field__label">Came from</span>
            <select className="ep-select" name="sourceId" defaultValue={sp.sourceId ?? ''}>
              <option value="">Any source</option>
              {meta.sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="ep-field">
            <span className="ep-field__label">Class sought</span>
            <select className="ep-select" name="classId" defaultValue={sp.classId ?? ''}>
              <option value="">Any class</option>
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
            <span className="ep-field__label">Search</span>
            <input
              className="ep-input"
              name="q"
              defaultValue={sp.q ?? ''}
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
      <Card>
        {list.data.length === 0 ? (
          <p style={{ margin: 0 }}>No enquiry matches.</p>
        ) : (
          <div className="ep-table-wrap">
            <table className="ep-table">
              <caption className="ep-sr-only">Enquiries</caption>
              <thead>
                <tr>
                  <th scope="col">Family</th>
                  <th scope="col">Class</th>
                  <th scope="col">Came from</th>
                  <th scope="col">Status</th>
                  <th scope="col">Next follow-up</th>
                  <th scope="col">Counsellor</th>
                  <th scope="col">Received</th>
                </tr>
              </thead>
              <tbody>
                {list.data.map((e) => {
                  const st = ENQUIRY_STATUS[e.status] ?? {
                    label: e.status,
                    tone: 'neutral' as const,
                  };
                  const late =
                    e.nextFollowUpOn &&
                    e.nextFollowUpOn < today &&
                    ['new', 'follow_up', 'interested'].includes(e.status);
                  return (
                    <tr key={e.id}>
                      <td>
                        <a href={`/admissions/enquiries/${e.id}`}>{e.parentName}</a>
                        <div className="ep-kicker">
                          {[e.childName, e.mobile ?? e.email].filter(Boolean).join(' · ')}
                        </div>
                      </td>
                      <td>{e.className ?? '-'}</td>
                      <td>
                        {e.source ?? '-'}
                        {e.campaign ? <div className="ep-kicker">{e.campaign}</div> : null}
                      </td>
                      <td>
                        <Badge tone={st.tone}>{st.label}</Badge>
                        {e.registrationNo ? (
                          <div className="ep-kicker">{e.registrationNo}</div>
                        ) : null}
                      </td>
                      <td>
                        {e.nextFollowUpOn ? (
                          late ? (
                            <Badge tone="danger">{dmy(e.nextFollowUpOn)}</Badge>
                          ) : (
                            dmy(e.nextFollowUpOn)
                          )
                        ) : (
                          '-'
                        )}
                      </td>
                      <td>{e.counsellor ?? '-'}</td>
                      <td>{dmy(e.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="ep-field__help">{list.total} enquiries</p>
      </Card>
    </>
  );
}
