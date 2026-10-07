import { Badge, Button, Card, DataTable, InputField, PageHeader, SelectField } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { deleteNotice, publishNotice } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type { Notice as NoticeRow, Page } from '@/lib/types';

/** S7-04: notices and circulars with audience and targets; publish and unpublish. */
export default async function NoticesPage({
  searchParams,
}: {
  searchParams: Promise<{
    ok?: string;
    error?: string;
    detail?: string;
    status?: string;
    q?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const sp = await searchParams;
  const [t, d, c, me] = await Promise.all([
    getTranslations('pages.academics_notices'),
    getTranslations('daily'),
    getTranslations('common'),
    getMe(),
  ]);
  const canManage = me.permissions.includes('academics.notice.manage');
  const query = new URLSearchParams({ size: '100', status: sp.status ?? 'all' });
  if (sp.q) query.set('q', sp.q);
  for (const k of ['from', 'to'] as const)
    if (/^\d{4}-\d{2}-\d{2}$/.test(sp[k] ?? '')) query.set(k, sp[k]!);
  const notices = await apiFetch<Page<NoticeRow>>(`/academics/notices?${query.toString()}`);

  return (
    <>
      <PageHeader
        kicker={t('kicker')}
        title="Notices and office orders"
        description="Notices and circulars show in the parent and student portal; office orders show to employees. Write your own text, attach files, ask for an acknowledgement and send it by e-mail too."
        actions={
          <>
            {canManage ? (
              <a className="ep-btn ep-btn--primary ep-btn--sm" href="/academics/notices/new">
                + Compose
              </a>
            ) : null}
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/academics/notices/report">
              Report
            </a>
          </>
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
          <InputField id="q" name="q" label={c('filter')} defaultValue={sp.q ?? ''} />
          <InputField id="from" name="from" label="From" type="date" defaultValue={sp.from ?? ''} />
          <InputField id="to" name="to" label="To" type="date" defaultValue={sp.to ?? ''} />
          {canManage ? (
            <SelectField
              id="status"
              name="status"
              label={d('status')}
              defaultValue={sp.status ?? 'all'}
              options={[
                { value: 'all', label: c('all') },
                { value: 'published', label: d('published') },
                { value: 'draft', label: d('draft') },
              ]}
            />
          ) : null}
          <Button type="submit" variant="secondary">
            {c('apply')}
          </Button>
        </form>
        <DataTable<NoticeRow>
          caption={t('title')}
          density="dense"
          columns={[
            { key: 'from', header: d('publishFrom'), render: (n) => n.publishFrom },
            {
              key: 'kind',
              header: d('kind'),
              render: (n) => (
                <Badge tone={n.kind === 'circular' ? 'warning' : 'info'}>
                  {n.kind === 'office_order' ? 'Office order' : d(`noticeKinds.${n.kind}`)}
                </Badge>
              ),
            },
            {
              key: 'title',
              header: d('title'),
              render: (n) => (
                <span>
                  {n.isPinned ? '📌 ' : ''}
                  <a href={`/academics/notices/${n.id}`} style={{ textDecoration: 'underline' }}>
                    <strong>{n.title}</strong>
                  </a>
                  <br />
                  <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-small)' }}>
                    {n.body
                      .replace(/<[^>]+>/g, ' ')
                      .replace(/&nbsp;/g, ' ')
                      .slice(0, 160)}
                  </span>
                </span>
              ),
            },
            { key: 'audience', header: d('audience'), render: (n) => d(`audiences.${n.audience}`) },
            {
              key: 'targets',
              header: d('targets'),
              render: (n) =>
                n.targets.length ? n.targets.map((x) => x.label).join(', ') : d('noTargets'),
            },
            {
              key: 'ack',
              header: 'Acknowledged',
              render: (n) =>
                n.ackRequired && !canManage ? (
                  n.ackedByMe ? (
                    <Badge tone="success">Acknowledged</Badge>
                  ) : (
                    <a
                      className="ep-btn ep-btn--primary ep-btn--sm"
                      href={`/academics/notices/${n.id}`}
                    >
                      Acknowledge
                    </a>
                  )
                ) : n.ackRequired ? (
                  <a
                    href={`/academics/acknowledgements?type=notice&id=${n.id}`}
                    style={{ textDecoration: 'underline' }}
                    aria-label={`Who acknowledged ${n.title}`}
                  >
                    {n.ackCount ?? 0} · view
                  </a>
                ) : (
                  '–'
                ),
            },
            {
              key: 'mail',
              header: 'E-mailed',
              render: (n) =>
                n.emailedCount === null || n.emailedCount === undefined ? '–' : n.emailedCount,
            },
            {
              key: 'status',
              header: d('status'),
              render: (n) => (
                <Badge tone={n.publishedAt ? 'success' : 'neutral'}>
                  {n.publishedAt ? d('published') : d('draft')}
                </Badge>
              ),
            },
            {
              key: 'actions',
              header: '',
              render: (n) =>
                canManage ? (
                  <span style={{ display: 'inline-flex', gap: 'var(--sp-2)' }}>
                    <form action={publishNotice}>
                      <input type="hidden" name="id" value={n.id} />
                      <input
                        type="hidden"
                        name="action"
                        value={n.publishedAt ? 'unpublish' : 'publish'}
                      />
                      <Button type="submit" variant="ghost" size="sm">
                        {n.publishedAt ? d('unpublish') : d('publish')}
                      </Button>
                    </form>
                    <form action={deleteNotice}>
                      <input type="hidden" name="id" value={n.id} />
                      <Button type="submit" variant="ghost" size="sm">
                        {d('delete')}
                      </Button>
                    </form>
                  </span>
                ) : null,
            },
          ]}
          rows={notices.data}
          rowKey={(n) => n.id}
          emptyTitle={d('noNotices')}
        />
      </Card>
    </>
  );
}
