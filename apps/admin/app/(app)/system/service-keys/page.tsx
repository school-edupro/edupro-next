import { Badge, Button, Card, DataTable, FormRow, InputField, PageHeader } from '@edupro/ui';
import { cookies } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { createServiceKey, revokeServiceKey } from '@/lib/actions';
import { apiFetch } from '@/lib/api';
import type { ServiceKeyRow } from '@/lib/types';

/** Sprint 16: machine service keys (issued once, revocable). */
export default async function ServiceKeysPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const [t, k, keys] = await Promise.all([
    getTranslations('pages.system_service_keys'),
    getTranslations('serviceKeys'),
    apiFetch<{ data: ServiceKeyRow[] }>('/platform/service-keys').then((x) => x.data),
  ]);
  const fresh = (await cookies()).get('edupro_new_service_key')?.value ?? null;
  const [freshName, freshKey] = fresh ? fresh.split('|') : [null, null];
  return (
    <>
      <PageHeader kicker={t('kicker')} title={t('title')} description={t('description')} />
      <Notice params={{ error: sp.error, detail: sp.detail }} />
      {sp.ok && freshKey ? (
        <div
          className="ep-alert ep-alert--success"
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          <strong>{freshName}</strong> — {k('shownOnce')}{' '}
          <code style={{ userSelect: 'all' }}>{freshKey}</code>
          <div className="ep-field__help">{k('usage')}</div>
        </div>
      ) : null}
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-5)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 560px), 1fr))',
        }}
      >
        <Card title={k('keys')}>
          <DataTable<ServiceKeyRow>
            caption={`${k('keys')} · ${keys.length}`}
            density="dense"
            columns={[
              { key: 'n', header: k('name'), render: (x) => <strong>{x.name}</strong> },
              { key: 's', header: k('scopes'), render: (x) => x.scopes.join(', ') },
              {
                key: 'st',
                header: k('status'),
                render: (x) => (
                  <Badge tone={x.revokedAt ? 'neutral' : 'success'}>
                    {x.revokedAt ? k('revoked') : x.status}
                  </Badge>
                ),
              },
              {
                key: 'u',
                header: k('lastUsed'),
                render: (x) =>
                  x.lastUsedAt ? x.lastUsedAt.slice(0, 16).replace('T', ' ') : k('never'),
              },
              { key: 'c', header: k('created'), render: (x) => x.createdAt.slice(0, 10) },
              {
                key: 'r',
                header: '',
                render: (x) =>
                  x.revokedAt ? null : (
                    <form action={revokeServiceKey}>
                      <input type="hidden" name="id" value={x.id} />
                      <Button type="submit" size="sm" variant="secondary">
                        {k('revoke')}
                      </Button>
                    </form>
                  ),
              },
            ]}
            rows={keys}
            rowKey={(x) => x.id}
            emptyTitle="—"
          />
        </Card>
        <Card title={k('issue')}>
          <form action={createServiceKey}>
            <FormRow columns={1}>
              <InputField
                id="name"
                name="name"
                label={k('name')}
                required
                minLength={2}
                maxLength={60}
              />
            </FormRow>
            <label
              className="ep-field"
              style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}
            >
              <input type="checkbox" name="scopes" value="shadow.feed" defaultChecked />
              <span>{k('shadowFeed')}</span>
            </label>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--sp-3)' }}>
              <Button type="submit">{k('issueBtn')}</Button>
            </div>
          </form>
        </Card>
      </div>
    </>
  );
}
