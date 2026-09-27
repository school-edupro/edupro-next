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
  toneForStatus,
} from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { createDocumentTemplate, installTemplateDefaults } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type { DocumentTemplate } from '@/lib/types';

const KINDS = ['transfer_certificate', 'bonafide', 'letter'] as const;

/** S7-01: document templates of the school. */
export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const [t, m, c, me] = await Promise.all([
    getTranslations('pages.system_templates'),
    getTranslations('templates'),
    getTranslations('common'),
    getMe(),
  ]);
  const canManage = me.permissions.includes('platform.template.manage');
  const templates = await apiFetch<{ data: DocumentTemplate[] }>('/platform/templates').then(
    (r) => r.data,
  );
  return (
    <>
      <PageHeader
        kicker={t('kicker')}
        title={t('title')}
        description={t('description')}
        actions={
          canManage ? (
            <form action={installTemplateDefaults}>
              <Button type="submit" variant="secondary">
                {m('installDefaults')}
              </Button>
            </form>
          ) : undefined
        }
      />
      <Notice params={sp} />
      <Card>
        <DataTable<DocumentTemplate>
          caption={t('title')}
          density="dense"
          columns={[
            {
              key: 'name',
              header: m('name'),
              render: (x) => <a href={`/system/templates/${x.id}`}>{x.name}</a>,
            },
            { key: 'code', header: m('code'), render: (x) => <code>{x.code}</code> },
            { key: 'kind', header: m('kind'), render: (x) => m(`kinds.${x.kind}`) },
            { key: 'page', header: m('page'), render: (x) => `${x.pageWidth} × ${x.pageHeight}` },
            { key: 'version', header: m('version'), numeric: true, render: (x) => x.version },
            {
              key: 'status',
              header: m('status'),
              render: (x) => <Badge tone={toneForStatus(x.status)}>{c(x.status)}</Badge>,
            },
          ]}
          rows={templates}
          rowKey={(x) => x.id}
          emptyTitle={m('noTemplates')}
        />
      </Card>
      {canManage ? (
        <Card title={m('newTemplate')} style={{ marginTop: 'var(--sp-5)' }}>
          <form action={createDocumentTemplate}>
            <FormRow columns={4}>
              <InputField
                id="code"
                name="code"
                label={m('code')}
                required
                pattern="[a-z0-9_]+"
                maxLength={40}
              />
              <InputField id="name" name="name" label={m('name')} required maxLength={120} />
              <SelectField
                id="kind"
                name="kind"
                label={m('kind')}
                options={KINDS.map((k) => ({ value: k, label: m(`kinds.${k}`) }))}
              />
              <InputField
                id="pageWidth"
                name="pageWidth"
                label={m('pageWidth')}
                defaultValue="210mm"
              />
            </FormRow>
            <FormRow columns={1}>
              <div className="ep-field">
                <label className="ep-field__label" htmlFor="bodyHtml">
                  {m('bodyHtml')}
                </label>
                <textarea
                  id="bodyHtml"
                  name="bodyHtml"
                  className="ep-input"
                  rows={10}
                  required
                  style={{ fontFamily: 'var(--font-mono, monospace)' }}
                />
              </div>
            </FormRow>
            <FormRow columns={1}>
              <div className="ep-field">
                <label className="ep-field__label" htmlFor="stylesCss">
                  {m('stylesCss')}
                </label>
                <textarea
                  id="stylesCss"
                  name="stylesCss"
                  className="ep-input"
                  rows={4}
                  style={{ fontFamily: 'var(--font-mono, monospace)' }}
                />
              </div>
            </FormRow>
            <input type="hidden" name="pageHeight" value="297mm" />
            <FormActions>
              <Button type="submit">{c('create')}</Button>
            </FormActions>
          </form>
        </Card>
      ) : null}
    </>
  );
}
