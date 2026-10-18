import { Badge, Breadcrumbs, Card, KpiTile, PageHeader } from '@edupro/ui';
import { BarChart, DonutChart, ProgressRows } from '@/components/charts/Charts';
import { Icon } from '@/components/nav-icons';
import { dt } from '@/components/consents/types';
import { apiFetch } from '@/lib/api';

interface FormRow {
  id: string;
  title: string;
  status: string;
  open: boolean;
  closedWhy: string | null;
  closesAt: string | null;
  closingSoon: boolean;
  asked: number;
  answered: number;
  rate: number | null;
  waiting: number;
  approved: number;
  rejected: number;
  feeRaised: number;
  feePaid: number;
}
interface Group {
  name: string;
  asked: number;
  answered: number;
  rate: number;
}
interface ConsentDashboard {
  canCreate: boolean;
  totals: {
    open: number;
    closingSoon: number;
    asked: number;
    answered: number;
    rate: number;
    waiting: number;
    feeRaised: number;
    feePaid: number;
  };
  forms: FormRow[];
  lowest: FormRow[];
  approvers: Array<{ who: string; count: number; oldest: string }>;
  byClass: Group[];
  byDepartment: Group[];
  daily: Array<{ date: string; app: number; link: number; office: number }>;
  ways: { app: number; link: number; office: number };
}

const rupees = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const tone = (r: number): 'success' | 'warning' | 'danger' =>
  r >= 80 ? 'success' : r >= 50 ? 'warning' : 'danger';
const days = (iso: string) => Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 864e5));

/**
 * The consent forms dashboard (docs/design/29-fee-and-consent-dashboards.md): every form the user may
 * open at a glance: response, the forms answering least, approvals waiting by approver, fees, the
 * classes and departments answering least on the open forms, and answers per day by way of answering.
 */
export default async function ConsentDashboardPage() {
  const d = await apiFetch<ConsentDashboard>('/engagement/consent-forms/dashboard');
  const t = d.totals;
  const formLink = (f: FormRow, tab?: string) =>
    `/engagement/consent-forms/${f.id}${tab ? `?tab=${tab}` : ''}`;

  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Consent forms', href: '/engagement/consent-forms' },
          { label: 'Dashboard' },
        ]}
      />
      <PageHeader
        kicker="Consent forms"
        title="Consent dashboard"
        description="All forms at a glance: who has answered, what waits for approval, fees, and where to push."
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', whiteSpace: 'nowrap' }}>
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/engagement/consent-forms">
              <Icon name="clipboard" size={16} /> All forms
            </a>
            {d.canCreate ? (
              <a className="ep-btn ep-btn--primary ep-btn--sm" href="/engagement/consent-forms/new">
                <Icon name="plus" size={16} /> New form
              </a>
            ) : null}
          </span>
        }
      />

      <h2 className="ep-sr-only">At a glance</h2>
      <div className="ep-cf-stats">
        <KpiTile label="Open forms" value={t.open} hint={`${t.closingSoon} close within 7 days`} />
        <KpiTile
          label="Answered (open forms)"
          value={`${t.rate}%`}
          hint={`${t.answered} of ${t.asked} asked`}
          delta={{
            text: t.rate >= 80 ? 'Good' : t.rate >= 50 ? 'Push' : 'Low',
            tone: tone(t.rate),
          }}
        />
        <KpiTile label="Waiting for approval" value={t.waiting} />
        <KpiTile
          label="Fees raised"
          value={rupees(t.feeRaised)}
          hint={`${rupees(t.feePaid)} paid · ${rupees(Math.max(0, t.feeRaised - t.feePaid))} to pay`}
        />
      </div>

      <div className="ep-chart__grid2">
        <Card title="Answering least (open forms)">
          {d.lowest.length ? (
            <ProgressRows
              label="Open forms with the lowest share answered"
              rows={d.lowest.map((f) => ({
                name: f.title,
                value: Math.min(f.answered, f.asked),
                of: f.asked,
                text: `${f.rate ?? 0}% · ${Math.max(0, f.asked - f.answered)} to answer`,
                tone: tone(f.rate ?? 0),
                href: formLink(f, 'pending'),
              }))}
            />
          ) : (
            <p className="ep-field__help">No open form asks anyone.</p>
          )}
        </Card>
        <Card title="Waiting for approval, by approver">
          {d.approvers.length ? (
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">Answers waiting for approval by approver</caption>
              <thead>
                <tr>
                  <th scope="col">With</th>
                  <th scope="col">Answers</th>
                  <th scope="col">Oldest</th>
                </tr>
              </thead>
              <tbody>
                {d.approvers.map((a) => (
                  <tr key={a.who}>
                    <th scope="row">{a.who}</th>
                    <td>{a.count}</td>
                    <td>
                      <Badge tone={days(a.oldest) > 3 ? 'danger' : 'neutral'}>
                        {days(a.oldest)} days
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="ep-field__help">Nothing waits for approval.</p>
          )}
        </Card>
      </div>

      <div className="ep-chart__grid2">
        <Card title="By class (open family forms)">
          {d.byClass.length ? (
            <ProgressRows
              label="Share answered by class on the open forms"
              rows={d.byClass.map((x) => ({
                name: x.name,
                value: x.answered,
                of: x.asked,
                text: `${x.rate}% · ${x.answered}/${x.asked}`,
                tone: tone(x.rate),
              }))}
            />
          ) : (
            <p className="ep-field__help">No open form asks families.</p>
          )}
        </Card>
        <Card title="By department (open staff forms)">
          {d.byDepartment.length ? (
            <ProgressRows
              label="Share answered by department on the open forms"
              rows={d.byDepartment.map((x) => ({
                name: x.name,
                value: x.answered,
                of: x.asked,
                text: `${x.rate}% · ${x.answered}/${x.asked}`,
                tone: tone(x.rate),
              }))}
            />
          ) : (
            <p className="ep-field__help">No open form asks staff.</p>
          )}
        </Card>
      </div>

      <div className="ep-chart__grid2">
        <Card title="Answers per day (last 30 days)">
          <BarChart
            title="Answers on each of the last 30 days, by way of answering"
            stacked
            series={[
              { label: 'App', tone: 'navy' },
              { label: 'Public link', tone: 'cyan' },
              { label: 'Office', tone: 'warning' },
            ]}
            data={d.daily.map((x) => ({
              label: x.date.slice(8),
              values: [x.app, x.link, x.office],
            }))}
          />
        </Card>
        <Card title="How they answered (all time)">
          <DonutChart
            title="Answers by way of answering"
            centre={String(d.ways.app + d.ways.link + d.ways.office)}
            caption="answers"
            parts={[
              { label: 'App', tone: 'navy', value: d.ways.app },
              { label: 'Public link', tone: 'cyan', value: d.ways.link },
              { label: 'Office (paper form)', tone: 'warning', value: d.ways.office },
            ]}
          />
        </Card>
      </div>

      <Card title={`Forms (${d.forms.length})`}>
        {d.forms.length ? (
          <div className="ep-table-wrap">
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">Published and closed forms</caption>
              <thead>
                <tr>
                  <th scope="col">Form</th>
                  <th scope="col">State</th>
                  <th scope="col">Closes</th>
                  <th scope="col">Answered</th>
                  <th scope="col">Approval</th>
                  <th scope="col">Fee raised / paid</th>
                </tr>
              </thead>
              <tbody>
                {d.forms.map((f) => (
                  <tr key={f.id}>
                    <td>
                      <a href={formLink(f)} style={{ textDecoration: 'underline' }}>
                        {f.title}
                      </a>
                    </td>
                    <td>
                      {f.open ? (
                        <Badge tone="success">Open</Badge>
                      ) : (
                        <Badge tone="neutral">{f.closedWhy ?? f.status}</Badge>
                      )}{' '}
                      {f.closingSoon ? <Badge tone="warning">Closes soon</Badge> : null}
                    </td>
                    <td>{f.closesAt ? dt(f.closesAt) : '—'}</td>
                    <td>
                      {f.asked
                        ? `${f.rate ?? 0}% · ${Math.min(f.answered, f.asked)}/${f.asked}`
                        : `${f.answered}`}
                    </td>
                    <td>
                      {f.waiting || f.approved || f.rejected
                        ? `${f.waiting} waiting · ${f.approved} approved · ${f.rejected} not`
                        : '—'}
                    </td>
                    <td>{f.feeRaised ? `${rupees(f.feeRaised)} / ${rupees(f.feePaid)}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="ep-field__help" style={{ margin: 0 }}>
            No published forms yet.
          </p>
        )}
      </Card>
    </>
  );
}
