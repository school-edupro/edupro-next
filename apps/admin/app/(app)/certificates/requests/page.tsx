import {
  Badge,
  Breadcrumbs,
  Button,
  Card,
  DataTable,
  KpiTile,
  PageHeader,
  SelectField,
} from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { Pager, pageSizeOf } from '@/components/Pager';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import {
  CHANNEL,
  STAGE,
  dmy,
  type CertificateRequest,
  type CertificateRequestList,
  type CertificateType,
} from '@/lib/certificates';

/**
 * Certificate requests (docs/design/87, phase C): what parents, students and staff asked for in their apps — waiting
 * for approval (and with whom), waiting for the fee, ready to issue — with their age; filtered, a page at a time.
 */
export default async function CertificateRequestsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('certificate.register.view')) notFound();
  const size = pageSizeOf(sp.size);
  const status = [
    'open',
    'submitted',
    'approved',
    'issued',
    'rejected',
    'withdrawn',
    'all',
  ].includes(sp.status ?? '')
    ? sp.status!
    : 'open';
  const filters = new URLSearchParams();
  if (status !== 'all') filters.set('status', status);
  if (sp.type && /^[A-Z][A-Z0-9_]{1,19}$/.test(sp.type)) filters.set('type', sp.type);
  if (sp.mine === 'true') filters.set('mine', 'true');
  if (sp.q) filters.set('q', sp.q.slice(0, 80));
  const qs = new URLSearchParams(filters);
  qs.set('size', size);
  qs.set('page', String(Math.max(1, Number(sp.page) || 1)));
  let list: CertificateRequestList;
  let types: CertificateType[];
  try {
    [list, types] = await Promise.all([
      apiFetch<CertificateRequestList>(`/certificate-requests?${qs.toString()}`),
      apiFetch<{ rows: CertificateType[] }>('/certificates/types').then((r) => r.rows),
    ]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) notFound();
    throw e;
  }
  const f = list.figures;
  const here = (page: number) => {
    const u = new URLSearchParams(filters);
    u.set('status', status);
    u.set('size', size);
    u.set('page', String(page));
    return `/certificates/requests?${u.toString()}`;
  };
  return (
    <>
      <Breadcrumbs
        items={[{ label: 'Certificate register', href: '/certificates' }, { label: 'Requests' }]}
      />
      <PageHeader
        kicker="Certificates"
        title="Certificate requests"
        description="Asked for in the parent, student and staff apps. Each is approved level by level as set on its type; a fee, when the type charges one, is paid before it is issued."
      />
      <Notice params={sp} />
      <div className="ep-dash-kpis">
        <KpiTile label="Waiting for approval" value={String(f.waiting)} />
        <KpiTile label="Waiting with me" value={String(f.mine)} />
        <KpiTile label="Waiting for the fee" value={String(f.fee)} />
        <KpiTile label="Ready to issue" value={String(f.ready)} />
        <KpiTile label="Issued this month" value={String(f.month)} />
        <KpiTile label="Oldest open (days)" value={f.oldest === null ? '—' : String(f.oldest)} />
      </div>
      <Card>
        <form
          method="get"
          aria-label="Filter the requests"
          style={{
            display: 'flex',
            gap: 'var(--sp-3)',
            alignItems: 'flex-end',
            flexWrap: 'wrap',
            marginBottom: 'var(--sp-4)',
          }}
        >
          <SelectField
            id="status"
            name="status"
            label="Status"
            defaultValue={status}
            options={[
              { value: 'open', label: 'Open (waiting or approved)' },
              { value: 'submitted', label: 'Waiting for approval' },
              { value: 'approved', label: 'Approved, not issued' },
              { value: 'issued', label: 'Issued' },
              { value: 'rejected', label: 'Not approved' },
              { value: 'withdrawn', label: 'Withdrawn' },
              { value: 'all', label: 'All' },
            ]}
          />
          <SelectField
            id="type"
            name="type"
            label="Type"
            defaultValue={filters.get('type') ?? ''}
            options={[
              { value: '', label: 'All types' },
              ...types.map((t) => ({ value: t.code, label: t.name })),
            ]}
          />
          <SelectField
            id="mine"
            name="mine"
            label="Waiting with"
            defaultValue={sp.mine === 'true' ? 'true' : ''}
            options={[
              { value: '', label: 'Anyone' },
              { value: 'true', label: 'Me' },
            ]}
          />
          <label className="ep-field" htmlFor="q" style={{ margin: 0 }}>
            <span className="ep-field__label">Name, admission no. or Emp. ID</span>
            <input id="q" name="q" className="ep-input" defaultValue={sp.q ?? ''} maxLength={80} />
          </label>
          <SelectField
            id="size"
            name="size"
            label="Per page"
            defaultValue={size}
            options={['25', '50', '100'].map((n) => ({ value: n, label: n }))}
          />
          <Button type="submit" variant="secondary">
            Apply
          </Button>
        </form>
        <DataTable<CertificateRequest>
          caption="Certificate requests"
          density="dense"
          columns={[
            {
              key: 'type',
              header: 'Request',
              render: (r) => (
                <a href={`/certificates/requests/${r.id}`}>
                  <strong>{r.typeName}</strong>
                </a>
              ),
            },
            {
              key: 'person',
              header: 'For',
              render: (r) => (
                <>
                  {r.person} · {r.personNo}
                  {r.classLabel ? (
                    <span className="ep-field__help" style={{ display: 'block', margin: 0 }}>
                      {r.classLabel}
                    </span>
                  ) : null}
                </>
              ),
            },
            {
              key: 'by',
              header: 'Asked by',
              render: (r) => `${r.requestedBy ?? ''} (${CHANNEL[r.channel]})`,
            },
            {
              key: 'purpose',
              header: 'Purpose',
              render: (r) =>
                `${r.purpose ?? ''}${r.copies > 1 ? ` · ${String(r.copies)} copies` : ''}`,
            },
            { key: 'on', header: 'Asked on', render: (r) => dmy(r.createdAt.slice(0, 10)) },
            {
              key: 'age',
              header: 'Days',
              render: (r) =>
                ['waiting', 'fee', 'ready'].includes(r.stage) ? String(r.ageDays) : '',
            },
            {
              key: 'stage',
              header: 'Stage',
              render: (r) => (
                <>
                  <Badge tone={STAGE[r.stage].tone}>{STAGE[r.stage].label}</Badge>
                  {r.waitingWith ? (
                    <span className="ep-field__help" style={{ display: 'block', margin: 0 }}>
                      {r.waitingWithMe ? 'With me · ' : ''}
                      {r.waitingWith}
                    </span>
                  ) : null}
                </>
              ),
            },
            {
              key: 'fee',
              header: 'Fee',
              render: (r) =>
                r.fee
                  ? `₹${r.fee.toFixed(2)}${r.feePaid ? ' paid' : r.feeWaived ? ' waived' : ''}`
                  : '—',
            },
          ]}
          rows={list.rows}
          rowKey={(r) => r.id}
          emptyTitle="No request matches"
        />
        <Pager
          page={Math.max(1, Number(sp.page) || 1)}
          size={Number(size)}
          total={list.total}
          href={here}
          noun="requests"
        />
      </Card>
    </>
  );
}
