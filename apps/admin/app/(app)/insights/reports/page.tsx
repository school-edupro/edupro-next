import { FileLinks } from '@/components/FileLinks';
import {
  Badge,
  Button,
  Card,
  DataTable,
  FormRow,
  InputField,
  PageHeader,
  SelectField,
} from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { runAiReport } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type { AiReport } from '@/lib/types';

const paise = (v: number) => `₹${(v / 100).toFixed(2)}`;

/** Sprint 16 (AI track): AI reports v1 — list, read, generate now. */
export default async function AiReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const [t, a, me, reports, current] = await Promise.all([
    getTranslations('pages.insights_reports'),
    getTranslations('aiReports'),
    getMe(),
    apiFetch<{ data: AiReport[] }>('/insights/reports').then((x) => x.data),
    sp.id
      ? apiFetch<AiReport>(`/insights/reports/${sp.id}`).catch(() => null)
      : Promise.resolve(null),
  ]);
  const canRun = me.permissions.includes('insights.report.run');
  const label = (x: AiReport) =>
    x.kind === 'principal_brief' ? a('principal') : `${a('department')} · ${x.department}`;
  return (
    <>
      <PageHeader kicker={t('kicker')} title={t('title')} description={t('description')} />
      <Notice params={sp} />
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-5)',
          gridTemplateColumns: current ? '1fr' : 'repeat(auto-fit, minmax(min(100%, 560px), 1fr))',
        }}
      >
        {current ? (
          <Card
            title={current.title}
            actions={
              <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
                <Badge tone="neutral">
                  {current.periodFrom} → {current.periodTo}
                </Badge>
                {current.exportId && current.exportStatus === 'ready' ? (
                  <span className="ep-filecell">
                    {a('pdfReady')}
                    <FileLinks
                      href={`/reports/exports/${current.exportId}/download`}
                      label={a('pdfReady')}
                    />
                  </span>
                ) : current.exportId ? (
                  <Badge tone="warning">{a('pdfPending')}</Badge>
                ) : null}
                <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/insights/reports">
                  {a('list')}
                </a>
              </span>
            }
          >
            <div className="ep-kicker">{a('narrative')}</div>
            <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5, marginBottom: 'var(--sp-4)' }}>
              {current.narrative}
            </div>
            <div className="ep-kicker">{a('facts')}</div>
            <table className="ep-table ep-table--dense" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>{a('fact')}</th>
                  <th>{a('label')}</th>
                  <th style={{ textAlign: 'right' }}>{a('value')}</th>
                  <th>{a('detail')}</th>
                </tr>
              </thead>
              <tbody>
                {current.facts.map((f) => (
                  <tr key={f.id}>
                    <td>
                      <code>{f.id}</code>
                      {current.citations.includes(f.id) ? (
                        <Badge tone="success">{a('citations')}</Badge>
                      ) : null}
                    </td>
                    <td>{f.label}</td>
                    <td style={{ textAlign: 'right' }}>
                      {f.value === null
                        ? '—'
                        : `${f.unit === '₹' ? '₹' : ''}${String(f.value)}${f.unit === '%' ? '%' : ''}`}
                    </td>
                    <td className="ep-field__help">
                      {Object.entries(f.detail ?? {})
                        .filter(([, v]) => v !== null && v !== '')
                        .map(([k, v]) => `${k}: ${String(v)}`)
                        .join(' · ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="ep-field__help" style={{ marginTop: 'var(--sp-3)' }}>
              {a('provider')}: {current.provider} · {current.model} · {a('cost')}{' '}
              {paise(current.costPaise)}
            </p>
          </Card>
        ) : null}
        <Card title={a('list')}>
          <DataTable<AiReport>
            caption={`${a('list')} · ${reports.length}`}
            density="dense"
            columns={[
              { key: 'p', header: a('period'), render: (x) => `${x.periodFrom} → ${x.periodTo}` },
              {
                key: 't',
                header: a('title'),
                render: (x) => (
                  <a href={`/insights/reports?id=${x.id}`}>
                    <strong>{x.title}</strong>
                    <div className="ep-kicker">
                      {label(x)} · {x.language}
                    </div>
                  </a>
                ),
              },
              { key: 'w', header: a('provider'), render: (x) => `${x.provider} · ${x.model}` },
              { key: 'c', header: a('cost'), numeric: true, render: (x) => paise(x.costPaise) },
              {
                key: 'pdf',
                header: a('pdf'),
                render: (x) =>
                  x.exportId && x.exportStatus === 'ready' ? (
                    <FileLinks
                      href={`/reports/exports/${x.exportId}/download`}
                      label={a('pdfReady')}
                    />
                  ) : (
                    (x.exportStatus ?? '')
                  ),
              },
            ]}
            rows={reports}
            rowKey={(x) => x.id}
            emptyTitle={a('none')}
          />
        </Card>
        {canRun && !current ? (
          <Card title={a('run')}>
            <form action={runAiReport}>
              <FormRow columns={2}>
                <SelectField
                  id="kind"
                  name="kind"
                  label={a('kind')}
                  options={[
                    { value: 'principal_brief', label: a('principal') },
                    { value: 'department_weekly', label: a('department') },
                  ]}
                />
                <SelectField
                  id="department"
                  name="department"
                  label={a('dept')}
                  options={[
                    { value: '', label: '—' },
                    ...['academics', 'attendance', 'fees', 'communication'].map((d) => ({
                      value: d,
                      label: d,
                    })),
                  ]}
                />
                <InputField id="periodTo" name="periodTo" label={a('periodTo')} type="date" />
                <SelectField
                  id="language"
                  name="language"
                  label={a('language')}
                  options={[
                    { value: 'en', label: 'English' },
                    { value: 'hi', label: 'हिन्दी' },
                  ]}
                />
              </FormRow>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Button type="submit">{a('runBtn')}</Button>
              </div>
            </form>
          </Card>
        ) : null}
      </div>
    </>
  );
}
