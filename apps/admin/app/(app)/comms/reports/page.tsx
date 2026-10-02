import { Card, PageHeader } from '@edupro/ui';
import { ExportWatcher } from '@/components/ExportWatcher';
import { Notice } from '@/components/Notice';
import { apiFetch } from '@/lib/api';
import { CHANNEL_LABEL, reportXlsxHref, type Channel, type CountBucket } from '@/lib/comms';
import { commsExport } from '@/lib/comms-actions';

interface Table {
  columns: Array<{ key: string; header: string; type?: string }>;
  rows: Array<Record<string, unknown>>;
}

const cell = (v: unknown, type?: string, key?: string) => {
  if (v === null || v === undefined || v === '') return '—';
  if (key === 'channel') return CHANNEL_LABEL[v as Channel] ?? String(v);
  if (type === 'datetime') return new Date(String(v)).toLocaleString('en-IN');
  if (type === 'number') return Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  return String(v);
};

function ExportButtons({
  dataset,
  params,
}: {
  dataset: 'comms_monthly_usage' | 'comms_failures';
  params: Record<string, string>;
}) {
  return (
    <span className="ep-cdash__export">
      <a
        className="ep-btn ep-btn--secondary ep-btn--sm"
        href={reportXlsxHref(dataset, params)}
        download
      >
        Excel
      </a>
      <form action={commsExport}>
        <input type="hidden" name="dataset" value={dataset} />
        {Object.entries(params).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <button
          type="submit"
          name="format"
          value="pdf"
          className="ep-btn ep-btn--secondary ep-btn--sm"
        >
          PDF
        </button>
      </form>
    </span>
  );
}

const STATEMENT_BUCKET: Record<string, CountBucket> = {
  messages: 'all',
  delivered: 'delivered',
  read: 'read',
  failed: 'failed',
  pending: 'pending',
};

/** The statement with every count a download of the delivery report behind it. */
function Statement({ t, from, to }: { t: Table; from: string; to: string }) {
  if (!t.rows.length) return <p className="ep-field__help">Nothing for these dates.</p>;
  // the statement months are whole months; the download keeps to the chosen dates inside each month
  const range = (month: string) => {
    const start = `${month}-01`;
    const [y, m] = month.split('-').map(Number) as [number, number];
    const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    return { from: start < from ? from : start, to: end > to ? to : end };
  };
  return (
    <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Monthly usage statement">
      <table className="ep-table">
        <caption className="ep-sr-only">Monthly usage statement</caption>
        <thead>
          <tr>
            {t.columns.map((c) => (
              <th key={c.key} scope="col" className={c.type === 'number' ? 'ep-num' : undefined}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {t.rows.map((r, i) => (
            <tr key={i}>
              {t.columns.map((c) => {
                const bucket = STATEMENT_BUCKET[c.key];
                const n = Number(r[c.key] ?? 0);
                const text = cell(r[c.key], c.type, c.key);
                return (
                  <td key={c.key} className={c.type === 'number' ? 'ep-num' : undefined}>
                    {bucket && n > 0 ? (
                      <a
                        className="ep-cdash__num"
                        download
                        href={reportXlsxHref('comms_delivery_log', {
                          ...range(String(r.month)),
                          channel: String(r.channel_code ?? ''),
                          bucket,
                        })}
                        title={`Download Excel: ${String(r.channel)} ${String(r.month)} ${bucket === 'all' ? 'messages' : bucket}`}
                      >
                        {text}
                      </a>
                    ) : (
                      text
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DataTable({ t, caption }: { t: Table; caption: string }) {
  if (!t.rows.length) return <p className="ep-field__help">Nothing for these dates.</p>;
  return (
    <div className="ep-table-wrap" tabIndex={0} role="region" aria-label={caption}>
      <table className="ep-table">
        <caption className="ep-sr-only">{caption}</caption>
        <thead>
          <tr>
            {t.columns.map((c) => (
              <th key={c.key} scope="col">
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {t.rows.map((r, i) => (
            <tr key={i}>
              {t.columns.map((c) => (
                <td key={c.key}>{cell(r[c.key], c.type, c.key)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Communication reports (v2): the monthly usage statement (messages, SMS parts, delivered, read,
 * failed, cost, credits added), failures by reason and the delivery log, each as Excel or PDF.
 */
export default async function CommsReportsPage({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string;
    to?: string;
    channel?: string;
    status?: string;
    export?: string;
    format?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const [y, m] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
  // the school session starts in April
  const yearStart = `${String(m >= 4 ? y : y - 1)}-04-01`;
  const from = sp.from ?? yearStart;
  const to = sp.to ?? today;
  const q = (extra: Record<string, string | undefined>) =>
    new URLSearchParams(
      Object.entries({ from, to, ...extra }).filter(([, v]) => v) as Array<[string, string]>,
    ).toString();
  const [statement, failures] = await Promise.all([
    apiFetch<Table>(`/comms/reports/comms_monthly_usage?${q({ channel: sp.channel })}`),
    apiFetch<Table>(`/comms/reports/comms_failures?${q({})}`),
  ]);
  const filters = Object.fromEntries(
    Object.entries({ from, to, channel: sp.channel ?? '' }).filter(([, v]) => v),
  );
  const totals = statement.rows.reduce<Record<string, number>>((acc, r) => {
    for (const k of ['messages', 'units', 'delivered', 'failed', 'cost', 'credited'])
      acc[k] = (acc[k] ?? 0) + Number(r[k] ?? 0);
    return acc;
  }, {});
  return (
    <>
      <PageHeader
        kicker="Communication"
        title="Communication reports"
        description="Monthly usage statement and failures for the dates and channel you choose, as Excel or PDF."
      />
      <Notice params={sp} />
      {sp.export ? (
        <ExportWatcher
          id={sp.export}
          format={sp.format === 'pdf' ? 'pdf' : 'xlsx'}
          labels={{
            queued: 'Report requested',
            ready: 'Download',
            pending: 'Preparing the file… it downloads automatically',
            failed: 'The file could not be made',
            stuck: 'Still waiting: the workers service makes the files; check that it is running.',
          }}
        />
      ) : null}
      <Card>
        <form method="get" className="ep-wd__form">
          <label className="ep-field" htmlFor="r-from">
            <span className="ep-field__label">From</span>
            <input id="r-from" name="from" type="date" className="ep-input" defaultValue={from} />
          </label>
          <label className="ep-field" htmlFor="r-to">
            <span className="ep-field__label">To</span>
            <input id="r-to" name="to" type="date" className="ep-input" defaultValue={to} />
          </label>
          <label className="ep-field" htmlFor="r-ch">
            <span className="ep-field__label">Channel</span>
            <select id="r-ch" name="channel" className="ep-select" defaultValue={sp.channel ?? ''}>
              <option value="">All</option>
              <option value="sms">SMS</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="email">Email</option>
            </select>
          </label>
          <button type="submit" className="ep-btn ep-btn--primary">
            Show
          </button>
        </form>
      </Card>
      <Card title="Monthly usage statement" style={{ marginTop: 'var(--sp-4)' }}>
        <div className="ep-cdash__bar">
          <p className="ep-field__help" style={{ margin: 0 }}>
            {Number(totals.messages ?? 0).toLocaleString('en-IN')} messages ·{' '}
            {Number(totals.units ?? 0).toLocaleString('en-IN')} units ·{' '}
            {Number(totals.delivered ?? 0).toLocaleString('en-IN')} delivered ·{' '}
            {Number(totals.failed ?? 0).toLocaleString('en-IN')} failed · ₹
            {Number(totals.cost ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })} ·{' '}
            {Number(totals.credited ?? 0).toLocaleString('en-IN')} credits added
          </p>
          <ExportButtons dataset="comms_monthly_usage" params={filters} />
        </div>
        <p className="ep-field__help">
          Click any count to download its delivery report (student, class, admission no., message).
        </p>
        <Statement t={statement} from={from} to={to} />
      </Card>
      <Card title="Failures by reason" style={{ marginTop: 'var(--sp-4)' }}>
        <div className="ep-cdash__bar">
          <span />
          <ExportButtons dataset="comms_failures" params={{ from, to }} />
        </div>
        <DataTable t={failures} caption="Failures by reason" />
      </Card>
      <p style={{ marginTop: 'var(--sp-4)' }}>
        <a href={`/comms/messages?${new URLSearchParams(filters).toString()}`}>
          Delivery log for these dates (search by mobile, email, name or admission no.) →
        </a>
      </p>
    </>
  );
}
