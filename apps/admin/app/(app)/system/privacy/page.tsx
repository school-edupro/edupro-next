import {
  Badge,
  Button,
  Card,
  DataTable,
  FormActions,
  FormRow,
  InputField,
  PageHeader,
  SelectField,
} from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import {
  breachRecord,
  breachUpdate,
  dsrCreateOffice,
  dsrErase,
  dsrSetStatus,
  publishPrivacyNotice,
} from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type { PrivacyNotice } from '@/lib/types';

interface Dsr {
  id: string;
  kind: string;
  principalKind: string;
  principalId: string;
  principal: string | null;
  requestedBy: string | null;
  channel: string;
  detail: string | null;
  status: string;
  receivedOn: string;
  dueOn: string;
  overdue: boolean;
  handledBy: string | null;
  outcome: string | null;
  exportId: string | null;
  exportStatus: string | null;
}
interface Breach {
  id: string;
  title: string;
  detectedAt: string;
  description: string;
  dataClasses: string[];
  principalsAffected: number;
  status: string;
  boardNotifiedAt: string | null;
  principalsNotifiedAt: string | null;
  actions: string | null;
  hoursToBoardNotice: number;
  owner: string | null;
}
interface Retention {
  policy: string;
  keepDays: number;
  lastAffected: number;
  lastRunAt: string;
  last30Days: number;
}
const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

/** System → Privacy: the DPDP notice (S11), data-principal requests, retention and the breach log (S20). */
export default async function PrivacyPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const [t, pv, d, me, notices] = await Promise.all([
    getTranslations('pages.system_privacy'),
    getTranslations('privacy'),
    getTranslations('dsr'),
    getMe(),
    apiFetch<{ data: PrivacyNotice[] }>('/engagement/privacy-notices').then((r) => r.data),
  ]);
  const canBreach = me.permissions.includes('platform.breach.manage');
  const canErase = me.permissions.includes('platform.privacy.erase');
  const [requests, retention, breaches] = await Promise.all([
    apiFetch<{ data: Dsr[] }>('/privacy/requests?size=100').then((r) => r.data),
    apiFetch<{ data: Retention[] }>('/privacy/retention').then((r) => r.data),
    canBreach
      ? apiFetch<{ data: Breach[] }>('/privacy/breaches').then((r) => r.data)
      : Promise.resolve([] as Breach[]),
  ]);
  const current = notices[0];
  const open = requests.filter((r) => r.status === 'received' || r.status === 'in_progress').length;
  return (
    <>
      <PageHeader
        kicker={t('kicker')}
        title={t('title')}
        description={t('description')}
        actions={open ? <Badge tone="warning">{d('openCount', { count: open })}</Badge> : undefined}
      />
      <Notice params={sp} />

      <Card title={d('requests')} style={{ marginBottom: 'var(--sp-4)' }}>
        <DataTable<Dsr>
          caption={`${d('requests')} · ${requests.length}`}
          density="dense"
          columns={[
            {
              key: 'k',
              header: d('kind'),
              render: (r) => (
                <>
                  <strong>{d(`kind_${r.kind}`)}</strong>
                  <div className="ep-kicker">
                    {r.channel} · {r.requestedBy ?? ''}
                  </div>
                </>
              ),
            },
            {
              key: 'p',
              header: d('principal'),
              render: (r) => (
                <>
                  {r.principal ?? r.principalId}
                  <div className="ep-kicker">{r.principalKind}</div>
                </>
              ),
            },
            { key: 'dt', header: d('detail'), render: (r) => r.detail ?? '' },
            {
              key: 'due',
              header: d('due'),
              render: (r) => (
                <>
                  {r.dueOn}
                  {r.overdue ? (
                    <>
                      {' '}
                      <Badge tone="danger">{d('overdue')}</Badge>
                    </>
                  ) : null}
                </>
              ),
            },
            {
              key: 's',
              header: d('status'),
              render: (r) => (
                <>
                  <Badge
                    tone={
                      r.status === 'completed'
                        ? 'success'
                        : r.status === 'refused'
                          ? 'danger'
                          : r.status === 'in_progress'
                            ? 'info'
                            : 'warning'
                    }
                  >
                    {d(`status_${r.status}`)}
                  </Badge>
                  {r.outcome ? <div className="ep-kicker">{r.outcome}</div> : null}
                  {r.exportId ? (
                    <div className="ep-kicker">
                      {r.exportStatus === 'ready' ? (
                        <a href={`/reports/exports/${r.exportId}/download`}>{d('report')}</a>
                      ) : (
                        `${d('report')} · ${r.exportStatus ?? ''}`
                      )}
                    </div>
                  ) : null}
                </>
              ),
            },
            {
              key: 'a',
              header: '',
              render: (r) =>
                r.status === 'completed' || r.status === 'refused' ? null : r.kind === 'erasure' ? (
                  canErase ? (
                    <form
                      action={dsrErase}
                      style={{ display: 'inline-flex', gap: 'var(--sp-1)', alignItems: 'flex-end' }}
                    >
                      <input type="hidden" name="id" value={r.id} />
                      <InputField
                        id={`er-${r.id}`}
                        name="reason"
                        label={d('eraseReason')}
                        required
                        minLength={5}
                        maxLength={500}
                      />
                      <Button type="submit" size="sm" variant="danger">
                        {d('erase')}
                      </Button>
                    </form>
                  ) : null
                ) : (
                  <form
                    action={dsrSetStatus}
                    style={{ display: 'inline-flex', gap: 'var(--sp-1)', alignItems: 'flex-end' }}
                  >
                    <input type="hidden" name="id" value={r.id} />
                    <InputField
                      id={`o-${r.id}`}
                      name="outcome"
                      label={d('outcome')}
                      maxLength={2000}
                    />
                    {r.status === 'received' ? (
                      <Button
                        type="submit"
                        name="status"
                        value="in_progress"
                        size="sm"
                        variant="ghost"
                      >
                        {d('start')}
                      </Button>
                    ) : null}
                    <Button type="submit" name="status" value="completed" size="sm">
                      {r.kind === 'access' ? d('completeAccess') : d('complete')}
                    </Button>
                    <Button type="submit" name="status" value="refused" size="sm" variant="ghost">
                      {d('refuse')}
                    </Button>
                  </form>
                ),
            },
          ]}
          rows={requests}
          rowKey={(r) => r.id}
          emptyTitle={d('noRequests')}
        />
        <details style={{ marginTop: 'var(--sp-3)' }}>
          <summary className="ep-btn ep-btn--secondary ep-btn--sm">{d('record')}</summary>
          <form action={dsrCreateOffice} style={{ marginTop: 'var(--sp-2)' }}>
            <FormRow columns={4}>
              <SelectField
                id="kind"
                name="kind"
                label={d('kind')}
                options={['access', 'correction', 'erasure', 'grievance'].map((k) => ({
                  value: k,
                  label: d(`kind_${k}`),
                }))}
              />
              <SelectField
                id="principalKind"
                name="principalKind"
                label={d('principalKind')}
                options={['student', 'guardian', 'employee'].map((k) => ({ value: k, label: k }))}
              />
              <InputField
                id="principalId"
                name="principalId"
                label={d('principalId')}
                required
                pattern="\\d+"
              />
              <SelectField
                id="channel"
                name="channel"
                label={d('channel')}
                options={['office', 'email', 'letter'].map((k) => ({ value: k, label: k }))}
              />
            </FormRow>
            <InputField id="detail" name="detail" label={d('detail')} maxLength={2000} />
            <FormActions>
              <Button type="submit" variant="secondary">
                {d('record')}
              </Button>
            </FormActions>
          </form>
        </details>
      </Card>

      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-5)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))',
          marginBottom: 'var(--sp-4)',
        }}
      >
        <Card title={d('retention')}>
          <p className="ep-field__help">{d('retentionHelp')}</p>
          <DataTable<Retention>
            caption={d('retention')}
            density="dense"
            columns={[
              { key: 'p', header: d('policy'), render: (r) => r.policy },
              { key: 'k', header: d('keepDays'), numeric: true, render: (r) => r.keepDays },
              { key: 'l', header: d('lastRun'), render: (r) => when(r.lastRunAt) },
              { key: 'a', header: d('lastAffected'), numeric: true, render: (r) => r.lastAffected },
              { key: 'm', header: d('last30'), numeric: true, render: (r) => r.last30Days },
            ]}
            rows={retention}
            rowKey={(r) => r.policy}
            emptyTitle={d('noRuns')}
          />
        </Card>
        {canBreach ? (
          <Card title={d('breaches')}>
            <p className="ep-field__help">{d('breachHelp')}</p>
            {breaches.map((b) => (
              <div
                key={b.id}
                style={{ padding: 'var(--sp-2) 0', borderTop: '1px solid var(--border-subtle)' }}
              >
                <div
                  style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-2)' }}
                >
                  <strong>{b.title}</strong>
                  <Badge
                    tone={
                      b.status === 'closed' ? 'neutral' : b.status === 'open' ? 'danger' : 'warning'
                    }
                  >
                    {b.status}
                  </Badge>
                </div>
                <div className="ep-kicker">
                  {d('detected')} {when(b.detectedAt)} · {b.principalsAffected} {d('principals')} ·{' '}
                  {b.dataClasses.join(', ')} · {d('boardClock', { hours: b.hoursToBoardNotice })}
                </div>
                <div>{b.description}</div>
                {b.actions ? <div className="ep-kicker">{b.actions}</div> : null}
                {b.status !== 'closed' ? (
                  <form
                    action={breachUpdate}
                    style={{
                      display: 'flex',
                      gap: 'var(--sp-1)',
                      alignItems: 'flex-end',
                      flexWrap: 'wrap',
                      marginTop: 'var(--sp-1)',
                    }}
                  >
                    <input type="hidden" name="id" value={b.id} />
                    <InputField
                      id={`ba-${b.id}`}
                      name="actions"
                      label={d('actions')}
                      maxLength={5000}
                    />
                    <label
                      style={{ display: 'inline-flex', gap: 'var(--sp-1)', alignItems: 'center' }}
                    >
                      <input
                        type="checkbox"
                        name="boardNotified"
                        defaultChecked={Boolean(b.boardNotifiedAt)}
                      />{' '}
                      {d('boardNotified')}
                    </label>
                    <label
                      style={{ display: 'inline-flex', gap: 'var(--sp-1)', alignItems: 'center' }}
                    >
                      <input
                        type="checkbox"
                        name="principalsNotified"
                        defaultChecked={Boolean(b.principalsNotifiedAt)}
                      />{' '}
                      {d('principalsNotified')}
                    </label>
                    <SelectField
                      id={`bs-${b.id}`}
                      name="status"
                      label={d('status')}
                      defaultValue={b.status}
                      options={['open', 'contained', 'notified', 'closed'].map((s) => ({
                        value: s,
                        label: s,
                      }))}
                    />
                    <Button type="submit" size="sm" variant="secondary">
                      {d('update')}
                    </Button>
                  </form>
                ) : null}
              </div>
            ))}
            <details style={{ marginTop: 'var(--sp-3)' }}>
              <summary className="ep-btn ep-btn--secondary ep-btn--sm">{d('recordBreach')}</summary>
              <form action={breachRecord} style={{ marginTop: 'var(--sp-2)' }}>
                <FormRow columns={2}>
                  <InputField
                    id="title"
                    name="title"
                    label={d('title')}
                    required
                    minLength={3}
                    maxLength={200}
                  />
                  <InputField
                    id="detectedAt"
                    name="detectedAt"
                    label={d('detected')}
                    type="datetime-local"
                    required
                  />
                  <InputField
                    id="dataClasses"
                    name="dataClasses"
                    label={d('dataClasses')}
                    placeholder="names, contacts, fees"
                  />
                  <InputField
                    id="principalsAffected"
                    name="principalsAffected"
                    label={d('principals')}
                    type="number"
                    min={0}
                    defaultValue="0"
                  />
                </FormRow>
                <label className="ep-field" htmlFor="description">
                  <span className="ep-field__label">{d('description')}</span>
                  <textarea
                    id="description"
                    name="description"
                    className="ep-input"
                    rows={4}
                    required
                    minLength={10}
                    maxLength={5000}
                  />
                </label>
                <FormActions>
                  <Button type="submit" variant="secondary">
                    {d('recordBreach')}
                  </Button>
                </FormActions>
              </form>
            </details>
          </Card>
        ) : null}
      </div>

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
