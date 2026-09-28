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
import { rcInstallDefaults, rcSaveTemplate } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type { ReportCardTemplate } from '@/lib/types';

const BANDS = ['primary', 'middle', 'secondary', 'senior'];

/** Sprint 17: the report-card designer (layout JSON, CSS, optional HTML body) with preview. */
export default async function ReportCardTemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{
    edit?: string;
    new?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const [t, r, me, templates] = await Promise.all([
    getTranslations('pages.exams_report_card_templates'),
    getTranslations('reportCards'),
    getMe(),
    apiFetch<{ data: ReportCardTemplate[] }>('/exams/report-cards/templates').then((x) => x.data),
  ]);
  const canManage = me.permissions.includes('exams.report_card.manage');
  const editing = sp.edit ? (templates.find((x) => x.id === sp.edit) ?? null) : null;
  const showForm = canManage && (sp.new || editing);
  return (
    <>
      <PageHeader
        kicker={t('kicker')}
        title={t('title')}
        description={t('description')}
        actions={
          canManage ? (
            <span style={{ display: 'inline-flex', gap: 'var(--sp-2)' }}>
              <a
                className="ep-btn ep-btn--primary ep-btn--sm"
                href="/exams/report-cards/templates?new=1"
              >
                ＋ {r('newRelease').replace(/release/i, 'template')}
              </a>
              <form action={rcInstallDefaults}>
                <Button type="submit" variant="secondary" size="sm">
                  {r('installDefaults')}
                </Button>
              </form>
            </span>
          ) : null
        }
      />
      <Notice params={sp} />
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-5)',
          gridTemplateColumns: showForm ? '1fr 1fr' : '1fr',
        }}
      >
        <Card title={r('templatesList')}>
          <DataTable<ReportCardTemplate>
            caption={r('templatesList')}
            density="dense"
            columns={[
              {
                key: 'n',
                header: r('name'),
                render: (x) => (
                  <>
                    <strong>{x.name}</strong>
                    <div className="ep-kicker">
                      {x.code} · v{x.version}
                    </div>
                  </>
                ),
              },
              { key: 'b', header: r('band'), render: (x) => x.band },
              {
                key: 's',
                header: r('status'),
                render: (x) => (
                  <Badge tone={x.status === 'active' ? 'success' : 'neutral'}>{x.status}</Badge>
                ),
              },
              {
                key: 'a',
                header: '',
                render: (x) => (
                  <span style={{ display: 'inline-flex', gap: 'var(--sp-1)' }}>
                    <a
                      className="ep-btn ep-btn--ghost ep-btn--sm"
                      href={`/api/report-cards/preview?templateId=${x.id}&band=${x.band}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {r('previewSample')}
                    </a>
                    {canManage ? (
                      <a
                        className="ep-btn ep-btn--ghost ep-btn--sm"
                        href={`/exams/report-cards/templates?edit=${x.id}`}
                      >
                        {r('designer')}
                      </a>
                    ) : null}
                  </span>
                ),
              },
            ]}
            rows={templates}
            rowKey={(x) => x.id}
            emptyTitle={r('noTemplates')}
          />
        </Card>
        {showForm ? (
          <Card title={editing ? `${r('designer')} · ${editing.name}` : r('designer')}>
            <form action={rcSaveTemplate}>
              {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
              <FormRow columns={2}>
                <InputField
                  id="code"
                  name="code"
                  label="Code"
                  required={!editing}
                  defaultValue={editing?.code ?? ''}
                  readOnly={Boolean(editing)}
                  pattern="[a-z0-9_]{2,40}"
                />
                <InputField
                  id="name"
                  name="name"
                  label={r('name')}
                  required
                  defaultValue={editing?.name ?? ''}
                  maxLength={120}
                />
                <SelectField
                  id="band"
                  name="band"
                  label={r('band')}
                  defaultValue={editing?.band ?? 'primary'}
                  options={BANDS.map((b) => ({ value: b, label: b }))}
                />
                {editing ? (
                  <SelectField
                    id="status"
                    name="status"
                    label={r('status')}
                    defaultValue={editing.status}
                    options={[
                      { value: 'active', label: 'active' },
                      { value: 'inactive', label: 'inactive' },
                    ]}
                  />
                ) : (
                  <div />
                )}
                <InputField
                  id="pageWidth"
                  name="pageWidth"
                  label={r('pageWidth')}
                  defaultValue={editing?.pageWidth ?? '210mm'}
                />
                <InputField
                  id="pageHeight"
                  name="pageHeight"
                  label={r('pageHeight')}
                  defaultValue={editing?.pageHeight ?? '297mm'}
                />
              </FormRow>
              <label className="ep-field">
                <span className="ep-field__label">{r('layout')}</span>
                <textarea
                  className="ep-input"
                  name="layout"
                  rows={12}
                  defaultValue={editing ? JSON.stringify(editing.layout, null, 2) : ''}
                  spellCheck={false}
                />
              </label>
              <label className="ep-field">
                <span className="ep-field__label">{r('stylesCss')}</span>
                <textarea
                  className="ep-input"
                  name="stylesCss"
                  rows={6}
                  defaultValue={editing?.stylesCss ?? ''}
                  spellCheck={false}
                />
              </label>
              <label className="ep-field">
                <span className="ep-field__label">{r('bodyHtml')}</span>
                <textarea
                  className="ep-input"
                  name="bodyHtml"
                  rows={6}
                  defaultValue={editing?.bodyHtml ?? ''}
                  spellCheck={false}
                  placeholder="<h1>{{student.name}}</h1> …"
                />
              </label>
              <div style={{ display: 'flex', gap: 'var(--sp-2)', justifyContent: 'flex-end' }}>
                <a className="ep-btn ep-btn--ghost" href="/exams/report-cards/templates">
                  Cancel
                </a>
                <Button type="submit">{r('save')}</Button>
              </div>
            </form>
            {editing ? (
              <iframe
                title={r('preview')}
                src={`/api/report-cards/preview?templateId=${editing.id}&band=${editing.band}`}
                style={{
                  width: '100%',
                  height: 640,
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-md)',
                  marginTop: 'var(--sp-3)',
                  background: 'white',
                }}
              />
            ) : null}
          </Card>
        ) : null}
      </div>
    </>
  );
}
