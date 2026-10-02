import { Badge, Button, Card, DataTable, InputField, PageHeader, SelectField } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { ExportWatcher } from '@/components/ExportWatcher';
import { cancelMessage, sendMessage } from '@/lib/actions';
import { reportXlsxHref } from '@/lib/comms';
import { commsExport } from '@/lib/comms-actions';
import { apiFetch, getMe } from '@/lib/api';
import type { Membership, Page, Template } from '@/lib/types';

const TONE: Record<string, 'neutral' | 'info' | 'success' | 'danger' | 'warning'> = {
  queued: 'info',
  sending: 'warning',
  sent: 'success',
  delivered: 'success',
  failed: 'danger',
  cancelled: 'neutral',
};

interface LogRow {
  id: string;
  created_at: string;
  channel: string;
  title: string;
  student_name: string | null;
  class_section: string | null;
  admission_no: string | null;
  recipient: string | null;
  address: string;
  status: string;
  units: number | null;
  cost: number | null;
  delivered_at: string | null;
  read_at: string | null;
  last_error: string | null;
  sent_by: string | null;
  message: string | null;
}

type Search = {
  ok?: string;
  error?: string;
  detail?: string;
  status?: string;
  channel?: string;
  from?: string;
  to?: string;
  q?: string;
  page?: string;
  size?: string;
  export?: string;
  format?: string;
};

const when = (v: string | null) =>
  v
    ? new Date(v).toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

/**
 * Delivery log (v2): a page at a time, today by default; dates, channel, status and one search box for
 * mobile, email, student or parent name and admission no.; each row shows the student it was about;
 * the filtered rows download as Excel (at once) or PDF.
 */
export default async function MessagesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const t = await getTranslations('pages.comms_messages');
  const sp = await searchParams;
  const me = await getMe();
  const canSend = me.permissions.includes('comms.message.send');
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  // today by default; a From date alone runs to today; dates the wrong way round are swapped
  const [from, to] = [sp.from || today, sp.to || today].sort() as [string, string];
  const size = ['25', '50', '100'].includes(sp.size ?? '') ? Number(sp.size) : 50;
  const page = Math.max(1, Number(sp.page) || 1);
  const filters = Object.fromEntries(
    Object.entries({
      from,
      to,
      channel: sp.channel,
      status: sp.status,
      q: sp.q?.trim(),
    }).filter(([, v]) => v),
  ) as Record<string, string>;
  const qs = (extra: Record<string, string>) =>
    new URLSearchParams({ ...filters, size: String(size), ...extra }).toString();
  const [log, templates, members] = await Promise.all([
    apiFetch<{ rows: LogRow[]; total: number; page: number; size: number }>(
      `/comms/reports/comms_delivery_log?${qs({ page: String(page) })}`,
    ),
    canSend
      ? apiFetch<{ data: Template[] }>('/comms/templates?status=active')
      : Promise.resolve({ data: [] as Template[] }),
    canSend && me.permissions.includes('access.assignment.view')
      ? apiFetch<Page<Membership>>('/access/memberships?size=200')
      : Promise.resolve({ data: [] as Membership[], page: { number: 1, size: 0, total: 0 } }),
  ]);
  const pages = Math.max(1, Math.ceil(log.total / size));
  const first = log.total ? (page - 1) * size + 1 : 0;
  const last = Math.min(log.total, page * size);
  const pageLinks = [...new Set([1, page - 2, page - 1, page, page + 1, page + 2, pages])]
    .filter((n) => n >= 1 && n <= pages)
    .sort((a, b) => a - b);

  return (
    <>
      <PageHeader kicker={t('kicker')} title={t('title')} description={t('description')} />
      <Notice params={sp} />
      {sp.export ? (
        <ExportWatcher
          id={sp.export}
          format={sp.format === 'pdf' ? 'pdf' : 'xlsx'}
          labels={{
            queued: 'Report requested',
            ready: 'Download',
            pending: 'Preparing the PDF… it downloads automatically',
            failed: 'The file could not be made',
            stuck:
              'Still waiting: PDFs are made by the workers service; check that it is running. Excel downloads at once.',
          }}
        />
      ) : null}
      <div className="ep-filter-band">
        <form method="get" className="ep-dlog__filters">
          <label className="ep-field" htmlFor="dl-from">
            <span className="ep-field__label">From</span>
            <input
              id="dl-from"
              name="from"
              type="date"
              className="ep-input"
              defaultValue={from}
              max={today}
            />
          </label>
          <label className="ep-field" htmlFor="dl-to">
            <span className="ep-field__label">To</span>
            <input
              id="dl-to"
              name="to"
              type="date"
              className="ep-input"
              defaultValue={to}
              max={today}
            />
          </label>
          <label className="ep-field ep-dlog__search" htmlFor="dl-q">
            <span className="ep-field__label">Mobile, email, name or admission no.</span>
            <input
              id="dl-q"
              name="q"
              type="search"
              className="ep-input"
              defaultValue={sp.q ?? ''}
              placeholder="e.g. 98222 or @gmail or Aarav or A-1024"
              maxLength={80}
            />
          </label>
          <SelectField
            id="channel"
            name="channel"
            label="Channel"
            defaultValue={sp.channel ?? ''}
            options={[
              { value: '', label: 'All' },
              { value: 'sms', label: 'SMS' },
              { value: 'whatsapp', label: 'WhatsApp' },
              { value: 'email', label: 'Email' },
              { value: 'push', label: 'App push' },
            ]}
          />
          <SelectField
            id="status"
            name="status"
            label="Status"
            defaultValue={sp.status ?? ''}
            options={[
              { value: '', label: 'All' },
              ...(['queued', 'sending', 'sent', 'delivered', 'failed', 'cancelled'] as const).map(
                (s) => ({ value: s, label: s[0]!.toUpperCase() + s.slice(1) }),
              ),
            ]}
          />
          <SelectField
            id="size"
            name="size"
            label="Rows per page"
            defaultValue={String(size)}
            options={['25', '50', '100'].map((n) => ({ value: n, label: n }))}
          />
          <Button type="submit">Show</Button>
          <a className="ep-btn ep-btn--secondary" href="/comms/messages">
            Today
          </a>
        </form>
      </div>
      <Card>
        <div className="ep-cdash__bar">
          <p className="ep-field__help" style={{ margin: 0 }} aria-live="polite">
            {log.total
              ? `${first.toLocaleString('en-IN')}–${last.toLocaleString('en-IN')} of ${log.total.toLocaleString('en-IN')} messages`
              : 'No messages for these filters.'}
            {from === to
              ? ` · ${new Date(`${from}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}`
              : ` · ${from} to ${to}`}
          </p>
          <span className="ep-cdash__export">
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={reportXlsxHref('comms_delivery_log', filters)}
              download
            >
              Excel
            </a>
            <form action={commsExport}>
              <input type="hidden" name="dataset" value="comms_delivery_log" />
              <input type="hidden" name="back" value="/comms/messages" />
              {Object.entries(filters).map(([k, v]) => (
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
        </div>
        <DataTable<LogRow>
          caption="Delivery log"
          density="dense"
          columns={[
            { key: 'when', header: 'Time', render: (m) => when(m.created_at) },
            { key: 'channel', header: 'Channel', render: (m) => m.channel },
            {
              key: 'title',
              header: 'Message',
              render: (m) => (
                <span title={m.message ?? ''}>
                  {m.title}
                  {m.sent_by ? <span className="ep-field__help"> · {m.sent_by}</span> : null}
                </span>
              ),
            },
            {
              key: 'student',
              header: 'Student',
              render: (m) =>
                m.student_name ? (
                  <>
                    {m.student_name}
                    <div className="ep-field__help">
                      {[m.class_section, m.admission_no].filter(Boolean).join(' · ')}
                    </div>
                  </>
                ) : (
                  '—'
                ),
            },
            {
              key: 'to',
              header: 'Sent to',
              render: (m) => (
                <>
                  {m.recipient ?? ''}
                  <div className="ep-field__help">{m.address}</div>
                </>
              ),
            },
            {
              key: 'status',
              header: 'Status',
              render: (m) => (
                <>
                  <Badge tone={TONE[m.status] ?? 'neutral'}>{m.status}</Badge>
                  {m.read_at ? <div className="ep-field__help">read {when(m.read_at)}</div> : null}
                  {!m.read_at && m.delivered_at ? (
                    <div className="ep-field__help">{when(m.delivered_at)}</div>
                  ) : null}
                </>
              ),
            },
            {
              key: 'cost',
              header: 'Units · ₹',
              numeric: true,
              render: (m) =>
                m.units ? `${String(m.units)} · ${Number(m.cost ?? 0).toFixed(2)}` : '',
            },
            { key: 'error', header: 'Error', render: (m) => m.last_error ?? '' },
            {
              key: 'actions',
              header: '',
              render: (m) =>
                canSend && m.status === 'queued' ? (
                  <form action={cancelMessage}>
                    <input type="hidden" name="id" value={m.id} />
                    <Button type="submit" variant="ghost" size="sm">
                      Cancel
                    </Button>
                  </form>
                ) : null,
            },
          ]}
          rows={log.rows}
          rowKey={(m) => m.id}
          emptyTitle="No messages for these filters"
        />
        {pages > 1 ? (
          <nav className="ep-grid__pager ep-dlog__pager" aria-label="Pages">
            {page > 1 ? (
              <a
                className="ep-btn ep-btn--ghost ep-btn--sm"
                href={`?${qs({ page: String(page - 1) })}`}
              >
                ← Previous
              </a>
            ) : null}
            {pageLinks.map((n, i) => (
              <span key={n}>
                {i > 0 && n - pageLinks[i - 1]! > 1 ? <span aria-hidden="true">… </span> : null}
                {n === page ? (
                  <span className="ep-btn ep-btn--primary ep-btn--sm" aria-current="page">
                    {n}
                  </span>
                ) : (
                  <a
                    className="ep-btn ep-btn--ghost ep-btn--sm"
                    href={`?${qs({ page: String(n) })}`}
                  >
                    {n}
                  </a>
                )}
              </span>
            ))}
            {page < pages ? (
              <a
                className="ep-btn ep-btn--ghost ep-btn--sm"
                href={`?${qs({ page: String(page + 1) })}`}
              >
                Next →
              </a>
            ) : null}
          </nav>
        ) : null}
      </Card>
      {canSend ? (
        <Card title="Send a message" style={{ marginTop: 'var(--sp-5)' }}>
          <form
            action={sendMessage}
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 'var(--sp-4)',
              alignItems: 'end',
            }}
          >
            <SelectField
              id="templateId"
              name="templateId"
              label="Template"
              required
              options={templates.data.map((t) => ({
                value: t.id,
                label: `${t.name} (${t.channel})`,
              }))}
            />
            {members.data.length > 0 ? (
              <SelectField
                id="recipientUserId"
                name="recipientUserId"
                label="Member"
                options={[
                  { value: '', label: 'Use the address below' },
                  ...members.data.map((m) => ({ value: m.userId, label: m.displayName })),
                ]}
              />
            ) : null}
            <InputField
              id="recipientAddress"
              name="recipientAddress"
              label="Mobile or email"
              placeholder="9876543210"
            />
            <InputField
              id="variables"
              name="variables"
              label="Variables (JSON)"
              placeholder='{"student_name":"Asha","amount":"₹1,200"}'
            />
            <div>
              <Button type="submit">Queue message</Button>
            </div>
          </form>
        </Card>
      ) : null}
    </>
  );
}
