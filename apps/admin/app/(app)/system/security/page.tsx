import {
  Badge,
  Button,
  Card,
  DataTable,
  FormActions,
  FormRow,
  FormSection,
  InputField,
  PageHeader,
  SelectField,
} from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { openBreakGlass } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';

interface Alert {
  id: number;
  at: string;
  kind: string;
  schoolId: string | null;
  count: number;
}
interface Impersonation {
  id: string;
  actorName: string;
  targetName: string;
  reason: string;
  startedAt: string;
  expiresAt: string;
  endedAt: string | null;
  active: boolean;
}
interface BreakGlass {
  id: string;
  userName: string;
  roleName: string;
  reason: string;
  startedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  reportSentAt: string | null;
  active: boolean;
}

export default async function SecurityPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const [t, me] = await Promise.all([getTranslations('security'), getMe()]);
  const [alerts, impersonations, breakGlass] = await Promise.all([
    apiFetch<{ data: Alert[] }>('/access/security/alerts'),
    apiFetch<{ data: Impersonation[] }>('/access/impersonation'),
    apiFetch<{ data: BreakGlass[] }>('/access/break-glass'),
  ]);
  const canBreakGlass = me.permissions.includes('access.assignment.manage') && !me.impersonation;
  const fmt = (iso: string) => new Date(iso).toLocaleString('en-IN');
  return (
    <>
      <PageHeader kicker={t('kicker')} title={t('title')} description={t('description')} />
      <Notice params={sp} />
      <Card title={t('alerts')}>
        <DataTable<Alert>
          caption={t('alerts')}
          density="dense"
          columns={[
            { key: 'at', header: t('when'), render: (a) => fmt(a.at) },
            { key: 'kind', header: t('kind'), render: (a) => <code>{a.kind}</code> },
            { key: 'count', header: t('count'), numeric: true, render: (a) => a.count },
          ]}
          rows={alerts.data}
          rowKey={(a) => String(a.id)}
          emptyTitle={t('noAlerts')}
        />
      </Card>
      <Card title={t('impersonations')} style={{ marginTop: 'var(--sp-4)' }}>
        <DataTable<Impersonation>
          caption={t('impersonations')}
          density="dense"
          columns={[
            { key: 'actor', header: t('actor'), render: (s) => s.actorName },
            { key: 'target', header: t('target'), render: (s) => s.targetName },
            { key: 'reason', header: t('reason'), render: (s) => s.reason },
            {
              key: 'window',
              header: t('window'),
              render: (s) => `${fmt(s.startedAt)} → ${fmt(s.expiresAt)}`,
            },
            {
              key: 'status',
              header: t('status'),
              render: (s) => (
                <Badge tone={s.active ? 'warning' : 'neutral'}>
                  {s.active ? t('active') : t('ended')}
                </Badge>
              ),
            },
          ]}
          rows={impersonations.data}
          rowKey={(s) => s.id}
          emptyTitle={t('noImpersonations')}
        />
      </Card>
      <Card title={t('breakGlass')} style={{ marginTop: 'var(--sp-4)' }}>
        <DataTable<BreakGlass>
          caption={t('breakGlass')}
          density="dense"
          columns={[
            { key: 'user', header: t('actor'), render: (e) => e.userName },
            { key: 'role', header: t('role'), render: (e) => e.roleName },
            { key: 'reason', header: t('reason'), render: (e) => e.reason },
            {
              key: 'window',
              header: t('window'),
              render: (e) => `${fmt(e.startedAt)} → ${fmt(e.expiresAt)}`,
            },
            {
              key: 'status',
              header: t('status'),
              render: (e) => (
                <Badge tone={e.active ? 'danger' : 'neutral'}>
                  {e.active ? t('active') : e.reportSentAt ? t('reported') : t('ended')}
                </Badge>
              ),
            },
          ]}
          rows={breakGlass.data}
          rowKey={(e) => e.id}
          emptyTitle={t('noBreakGlass')}
        />
        {canBreakGlass ? (
          <form action={openBreakGlass} style={{ marginTop: 'var(--sp-4)' }}>
            <FormSection title={t('openBreakGlass')} description={t('breakGlassHelp')}>
              <FormRow columns={3}>
                <SelectField
                  id="roleCode"
                  name="roleCode"
                  label={t('role')}
                  options={[
                    { value: 'school_admin', label: 'School Admin' },
                    { value: 'group_admin', label: 'Group Admin' },
                  ]}
                />
                <InputField
                  id="hours"
                  name="hours"
                  label={t('hours')}
                  type="number"
                  min={1}
                  max={4}
                  defaultValue={4}
                />
              </FormRow>
              <InputField
                id="reason"
                name="reason"
                label={t('reason')}
                required
                minLength={20}
                placeholder={t('reasonPlaceholder')}
              />
              <FormActions>
                <Button type="submit" variant="danger">
                  {t('openBreakGlass')}
                </Button>
              </FormActions>
            </FormSection>
          </form>
        ) : null}
      </Card>
    </>
  );
}
