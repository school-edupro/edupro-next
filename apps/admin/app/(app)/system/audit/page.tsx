import { Alert, Button, Card, InputField, PageHeader, SelectField } from '@edupro/ui';
import { AuditGrid } from '@/components/AuditGrid';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { exportAudit } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type { AuditRow, Page } from '@/lib/types';

type Search = {
  ok?: string;
  error?: string;
  detail?: string;
  from?: string;
  to?: string;
  entityType?: string;
  entityId?: string;
  action?: string;
  actorUserId?: string;
};

export default async function AuditPage({ searchParams }: { searchParams: Promise<Search> }) {
  const t = await getTranslations('pages.system_audit');
  const sp = await searchParams;
  const me = await getMe();
  const canExport = me.permissions.includes('platform.audit.export');
  const q = new URLSearchParams({ size: '200' });
  if (sp.from) q.set('from', new Date(sp.from).toISOString());
  if (sp.to) q.set('to', new Date(sp.to).toISOString());
  for (const key of ['entityType', 'entityId', 'action', 'actorUserId'] as const)
    if (sp[key]) q.set(key, sp[key]!);
  const result = await apiFetch<Page<AuditRow>>(`/platform/audit?${q.toString()}`);

  return (
    <>
      <PageHeader kicker={t('kicker')} title={t('title')} description={t('description')} />
      <Notice params={sp} />
      <div className="ep-filter-band">
        <form
          method="get"
          style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'flex-end', flexWrap: 'wrap' }}
        >
          <InputField id="from" name="from" label="From" type="date" defaultValue={sp.from ?? ''} />
          <InputField id="to" name="to" label="To" type="date" defaultValue={sp.to ?? ''} />
          <InputField
            id="action"
            name="action"
            label="Action starts with"
            defaultValue={sp.action ?? ''}
            placeholder="access.assignment"
          />
          <InputField
            id="entityType"
            name="entityType"
            label="Entity"
            defaultValue={sp.entityType ?? ''}
            placeholder="user_roles"
          />
          <InputField
            id="entityId"
            name="entityId"
            label="Entity id"
            defaultValue={sp.entityId ?? ''}
          />
          <Button type="submit" variant="secondary">
            Filter
          </Button>
        </form>
      </div>
      <Card>
        <AuditGrid rows={result.data} />
        <p
          style={{
            marginTop: 'var(--sp-3)',
            color: 'var(--text-muted)',
            fontSize: 'var(--fs-small)',
          }}
        >
          {result.page.total} entries match the filter.
        </p>
      </Card>
      {canExport ? (
        <Card title="Export this view" style={{ marginTop: 'var(--sp-5)' }}>
          <form
            action={exportAudit}
            style={{
              display: 'flex',
              gap: 'var(--sp-3)',
              alignItems: 'flex-end',
              flexWrap: 'wrap',
            }}
          >
            <input type="hidden" name="from" value={sp.from ?? ''} />
            <input type="hidden" name="to" value={sp.to ?? ''} />
            <input type="hidden" name="action" value={sp.action ?? ''} />
            <input type="hidden" name="entityType" value={sp.entityType ?? ''} />
            <input type="hidden" name="entityId" value={sp.entityId ?? ''} />
            <SelectField
              id="format"
              name="format"
              label="Format"
              options={[
                { value: 'xlsx', label: 'Excel' },
                { value: 'csv', label: 'CSV' },
                { value: 'pdf', label: 'PDF' },
              ]}
            />
            <Button type="submit">Create export</Button>
            <span className="ep-field__help">
              Needs a recent multi-factor sign-in. The export is itself audited and appears in the
              export centre.
            </span>
          </form>
        </Card>
      ) : (
        <div style={{ marginTop: 'var(--sp-4)' }}>
          <Alert tone="info">
            Exporting the audit log is reserved for the Auditor role (segregation of duties with
            role granting).
          </Alert>
        </div>
      )}
    </>
  );
}
