import {
  Badge,
  Button,
  Card,
  DataTable,
  FormActions,
  FormRow,
  InputField,
  PageHeader,
} from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { publishPrivacyNotice } from '@/lib/actions';
import { apiFetch } from '@/lib/api';
import type { PrivacyNotice } from '@/lib/types';

export default async function PrivacyPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const [t, pv, notices] = await Promise.all([
    getTranslations('pages.system_privacy'),
    getTranslations('privacy'),
    apiFetch<{ data: PrivacyNotice[] }>('/engagement/privacy-notices').then((r) => r.data),
  ]);
  const current = notices[0];
  return (
    <>
      <PageHeader kicker={t('kicker')} title={t('title')} description={t('description')} />
      <Notice params={sp} />
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-5)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))',
        }}
      >
        <Card title={current ? `${pv('current')} · v${current.version}` : pv('noNotice')}>
          {current ? (
            <>
              <h4 style={{ marginTop: 0 }}>{current.title}</h4>
              <p style={{ whiteSpace: 'pre-wrap' }}>{current.body}</p>
              {current.bodyHi ? (
                <p style={{ whiteSpace: 'pre-wrap' }} lang="hi">
                  {current.bodyHi}
                </p>
              ) : null}
            </>
          ) : null}
          <DataTable<PrivacyNotice>
            caption={pv('version')}
            density="dense"
            columns={[
              { key: 'v', header: pv('version'), render: (n) => `v${n.version}` },
              { key: 'title', header: pv('title'), render: (n) => n.title },
              {
                key: 'pub',
                header: pv('publishedAt'),
                render: (n) =>
                  n.publishedAt ? new Date(n.publishedAt).toLocaleDateString('en-IN') : '',
              },
              {
                key: 'ack',
                header: pv('acknowledgements'),
                numeric: true,
                render: (n) => (
                  <Badge tone={n.acknowledgements ? 'success' : 'neutral'}>
                    {n.acknowledgements}
                  </Badge>
                ),
              },
            ]}
            rows={notices}
            rowKey={(n) => String(n.version)}
            emptyTitle={pv('noNotice')}
          />
        </Card>
        <Card title={pv('publish')}>
          <p className="ep-field__help">{pv('publishHelp')}</p>
          <form action={publishPrivacyNotice}>
            <FormRow columns={1}>
              <InputField
                id="title"
                name="title"
                label={pv('title')}
                required
                maxLength={200}
                defaultValue={current?.title ?? ''}
              />
            </FormRow>
            <label className="ep-field" htmlFor="body">
              <span className="ep-field__label">{pv('body')}</span>
              <textarea
                id="body"
                name="body"
                className="ep-input"
                rows={10}
                required
                minLength={20}
                maxLength={20000}
                defaultValue={current?.body ?? ''}
              />
            </label>
            <label className="ep-field" htmlFor="bodyHi" style={{ marginTop: 'var(--sp-2)' }}>
              <span className="ep-field__label">{pv('bodyHi')}</span>
              <textarea
                id="bodyHi"
                name="bodyHi"
                className="ep-input"
                rows={8}
                maxLength={20000}
                defaultValue={current?.bodyHi ?? ''}
                lang="hi"
              />
            </label>
            <FormActions>
              <Button type="submit">{pv('publish')}</Button>
            </FormActions>
          </form>
        </Card>
      </div>
    </>
  );
}
