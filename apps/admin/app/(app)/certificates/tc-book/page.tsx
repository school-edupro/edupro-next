import { Badge, Breadcrumbs, Button, Card, DataTable, PageHeader, SelectField } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { Pager } from '@/components/Pager';
import { DownloadMenu } from '@/components/leave/ListBar';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { dmy, type TcBookRow } from '@/lib/certificates';

/** The TC book register (docs/design/87, phase E): every TC by book and Sl. No., 100 to a book. */
export default async function TcBookPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('certificate.register.view')) notFound();
  const f = new URLSearchParams();
  if (sp.book && /^\d{1,6}$/.test(sp.book)) f.set('book', sp.book);
  if (sp.status === 'issued' || sp.status === 'cancelled') f.set('status', sp.status);
  for (const k of ['from', 'to'] as const)
    if (sp[k] && /^\d{4}-\d{2}-\d{2}$/.test(sp[k]!)) f.set(k, sp[k]!);
  if (sp.q) f.set('q', sp.q.slice(0, 80));
  const qs = new URLSearchParams(f);
  qs.set('size', '100');
  qs.set('page', String(Math.max(1, Number(sp.page) || 1)));
  let r: { total: number; books: number[]; rows: TcBookRow[] };
  try {
    r = await apiFetch(`/certificates/tc-book?${qs.toString()}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) notFound();
    throw e;
  }
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Certificate register', href: '/certificates' },
          { label: 'TC book register' },
        ]}
      />
      <PageHeader
        kicker="Certificates"
        title="TC book register"
        description="Every transfer certificate by its book and Sl. No.; a cancelled one keeps its number."
        actions={
          <DownloadMenu
            xlsx={`/api/certificates-file?kind=tc-book&format=xlsx&${f.toString()}`}
            pdf={`/api/certificates-file?kind=tc-book&format=pdf&${f.toString()}`}
          />
        }
      />
      <Notice params={sp} />
      <Card>
        <form
          method="get"
          style={{
            display: 'flex',
            gap: 'var(--sp-3)',
            alignItems: 'flex-end',
            flexWrap: 'wrap',
            marginBottom: 'var(--sp-4)',
          }}
        >
          <SelectField
            id="book"
            name="book"
            label="Book"
            defaultValue={f.get('book') ?? ''}
            options={[
              { value: '', label: 'All books' },
              ...r.books.map((b) => ({ value: String(b), label: `Book ${String(b)}` })),
            ]}
          />
          <SelectField
            id="status"
            name="status"
            label="Status"
            defaultValue={f.get('status') ?? ''}
            options={[
              { value: '', label: 'Any' },
              { value: 'issued', label: 'Issued' },
              { value: 'cancelled', label: 'Cancelled' },
            ]}
          />
          <label className="ep-field" htmlFor="from" style={{ margin: 0 }}>
            <span className="ep-field__label">Issued from</span>
            <input
              id="from"
              name="from"
              type="date"
              className="ep-input"
              defaultValue={f.get('from') ?? ''}
            />
          </label>
          <label className="ep-field" htmlFor="to" style={{ margin: 0 }}>
            <span className="ep-field__label">Issued to</span>
            <input
              id="to"
              name="to"
              type="date"
              className="ep-input"
              defaultValue={f.get('to') ?? ''}
            />
          </label>
          <label className="ep-field" htmlFor="q" style={{ margin: 0 }}>
            <span className="ep-field__label">TC no., student or admission no.</span>
            <input id="q" name="q" className="ep-input" defaultValue={sp.q ?? ''} maxLength={80} />
          </label>
          <Button type="submit" variant="secondary">
            Apply
          </Button>
        </form>
        <DataTable<TcBookRow>
          caption="TC book register"
          density="dense"
          columns={[
            { key: 'b', header: 'Book', render: (x) => (x.bookNo ? String(x.bookNo) : '') },
            { key: 's', header: 'Sl. no.', render: (x) => (x.slNo ? String(x.slNo) : '') },
            {
              key: 'n',
              header: 'TC no.',
              render: (x) => <a href={`/certificates/${x.id}`}>{x.number}</a>,
            },
            { key: 'on', header: 'Issued on', render: (x) => dmy(x.issuedOn) },
            {
              key: 'who',
              header: 'Student',
              render: (x) => `${x.name ?? ''}${x.admissionNo ? ` · ${x.admissionNo}` : ''}`,
            },
            { key: 'cl', header: 'Last class', render: (x) => x.lastClass ?? '' },
            { key: 'r', header: 'Reason', render: (x) => x.reason ?? '' },
            { key: 'c', header: 'Copies', render: (x) => (x.copies ? String(x.copies) : '') },
            {
              key: 'st',
              header: 'Status',
              render: (x) => (
                <Badge tone={x.status === 'issued' ? 'success' : 'danger'}>
                  {x.status === 'issued' ? 'Issued' : 'Cancelled'}
                </Badge>
              ),
            },
          ]}
          rows={r.rows}
          rowKey={(x) => x.id}
          emptyTitle="No TC"
        />
        <Pager
          page={Math.max(1, Number(sp.page) || 1)}
          size={100}
          total={r.total}
          href={(p) => {
            const u = new URLSearchParams(f);
            u.set('page', String(p));
            return `/certificates/tc-book?${u.toString()}`;
          }}
          noun="TCs"
        />
      </Card>
    </>
  );
}
