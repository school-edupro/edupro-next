import { Badge, Button, Card, DataTable, InputField, PageHeader, SelectField } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { libraryAccession, libraryCopyStatus } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type { LibraryCopy, LibraryTitle, Page } from '@/lib/types';

/** Sprint 17: the catalogue with copies and accession. */
export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    category?: string;
    available?: string;
    title?: string;
    page?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const q = new URLSearchParams({ page: sp.page ?? '1', size: '50' });
  if (sp.q) q.set('q', sp.q);
  if (sp.category) q.set('category', sp.category);
  if (sp.available) q.set('available', 'true');
  const [t, l, me, titles] = await Promise.all([
    getTranslations('pages.library'),
    getTranslations('library'),
    getMe(),
    apiFetch<Page<LibraryTitle>>(`/library/catalogue?${q.toString()}`),
  ]);
  const canManage = me.permissions.includes('library.catalogue.manage');
  const current = sp.title
    ? (titles.data.find((x) => x.id === sp.title) ??
      (await apiFetch<Page<LibraryTitle>>(`/library/catalogue?size=1&q=`).then(() => null)))
    : null;
  const copies = sp.title
    ? await apiFetch<{ data: LibraryCopy[] }>(`/library/titles/${sp.title}/copies`).then(
        (x) => x.data,
      )
    : [];
  return (
    <>
      <PageHeader
        kicker={t('kicker')}
        title={t('title')}
        description={t('description')}
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/masters/library">
            Library setup
          </a>
        }
      />
      <Notice params={sp} />
      <Card>
        <form method="get" className="ep-master__filter">
          <InputField
            id="q"
            name="q"
            label={l('search')}
            defaultValue={sp.q ?? ''}
            maxLength={80}
          />
          <InputField
            id="category"
            name="category"
            label={l('category')}
            defaultValue={sp.category ?? ''}
            maxLength={60}
          />
          <label style={{ display: 'inline-flex', gap: 'var(--sp-1)', alignItems: 'center' }}>
            <input
              type="checkbox"
              name="available"
              value="1"
              defaultChecked={Boolean(sp.available)}
            />{' '}
            {l('onlyAvailable')}
          </label>
          <Button type="submit" variant="secondary" size="sm">
            {l('apply')}
          </Button>
        </form>
        <DataTable<LibraryTitle>
          caption={`${t('title')} · ${titles.page.total}`}
          density="dense"
          columns={[
            {
              key: 't',
              header: l('title'),
              render: (x) => (
                <a href={`/library?title=${x.id}${sp.q ? `&q=${encodeURIComponent(sp.q)}` : ''}`}>
                  <strong>{x.title}</strong>
                  <div className="ep-kicker">
                    {x.code}
                    {x.category ? ` · ${x.category}` : ''}
                    {x.isReference ? ` · ${l('reference')}` : ''}
                  </div>
                </a>
              ),
            },
            { key: 'a', header: l('author'), render: (x) => x.author ?? '' },
            { key: 'c', header: l('copies'), numeric: true, render: (x) => x.copies },
            {
              key: 'v',
              header: l('available'),
              numeric: true,
              render: (x) => (
                <Badge tone={x.available > 0 ? 'success' : 'neutral'}>{x.available}</Badge>
              ),
            },
            { key: 'l', header: l('location'), render: (x) => x.location ?? '' },
          ]}
          rows={titles.data}
          rowKey={(x) => x.id}
          emptyTitle="—"
        />
      </Card>
      {sp.title ? (
        <Card
          title={l('copiesOf', { title: current?.title ?? sp.title })}
          style={{ marginTop: 'var(--sp-4)' }}
        >
          {canManage ? (
            <form action={libraryAccession} className="ep-master__filter">
              <input type="hidden" name="titleId" value={sp.title} />
              <InputField
                id="accessionNos"
                name="accessionNos"
                label={l('accessionNos')}
                maxLength={400}
              />
              <InputField
                id="count"
                name="count"
                label={l('count')}
                type="number"
                min={1}
                max={200}
              />
              <InputField
                id="accessionedOn"
                name="accessionedOn"
                label={l('accessionedOn')}
                type="date"
              />
              <InputField id="source" name="source" label={l('source')} maxLength={60} />
              <Button type="submit" size="sm">
                {l('add')}
              </Button>
            </form>
          ) : null}
          <DataTable<LibraryCopy>
            caption={l('copies')}
            density="dense"
            columns={[
              {
                key: 'n',
                header: l('accessionNo'),
                render: (c) => <strong>{c.accessionNo}</strong>,
              },
              { key: 'd', header: l('accessionedOn'), render: (c) => c.accessionedOn },
              { key: 's', header: l('source'), render: (c) => c.source ?? '' },
              {
                key: 'st',
                header: l('status'),
                render: (c) => (
                  <Badge
                    tone={
                      c.status === 'available'
                        ? 'success'
                        : c.status === 'issued'
                          ? 'info'
                          : 'danger'
                    }
                  >
                    {c.status}
                  </Badge>
                ),
              },
              {
                key: 'l',
                header: l('loan'),
                render: (c) => (c.loan ? `${c.loan.borrower} · ${l('dueOn')} ${c.loan.dueOn}` : ''),
              },
              {
                key: 'a',
                header: '',
                render: (c) =>
                  canManage && c.status !== 'issued' ? (
                    <form
                      action={libraryCopyStatus}
                      style={{ display: 'inline-flex', gap: 'var(--sp-1)', alignItems: 'flex-end' }}
                    >
                      <input type="hidden" name="titleId" value={sp.title} />
                      <input type="hidden" name="copyId" value={c.id} />
                      <SelectField
                        id={`s-${c.id}`}
                        name="status"
                        label={l('markStatus')}
                        defaultValue={c.status === 'issued' ? 'available' : c.status}
                        options={['available', 'damaged', 'lost', 'withdrawn'].map((v) => ({
                          value: v,
                          label: v,
                        }))}
                      />
                      <Button type="submit" size="sm" variant="ghost">
                        {l('markStatus')}
                      </Button>
                    </form>
                  ) : null,
              },
            ]}
            rows={copies}
            rowKey={(c) => c.id}
            emptyTitle="—"
          />
        </Card>
      ) : null}
    </>
  );
}
