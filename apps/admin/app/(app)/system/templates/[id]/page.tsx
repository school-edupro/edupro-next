import {
  Breadcrumbs,
  Button,
  Card,
  FormActions,
  FormRow,
  InputField,
  PageHeader,
  SelectField,
} from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { renderTemplateFor, updateDocumentTemplate } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type { DocumentTemplate } from '@/lib/types';

export default async function TemplatePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const [t, m, c, me, template, preview] = await Promise.all([
    getTranslations('pages.system_templates'),
    getTranslations('templates'),
    getTranslations('common'),
    getMe(),
    apiFetch<DocumentTemplate>(`/platform/templates/${id}`),
    apiFetch<{ html: string }>(`/platform/templates/${id}/preview`, {
      method: 'POST',
      body: '{}',
    }).catch(() => ({ html: '' })),
  ]);
  const canManage = me.permissions.includes('platform.template.manage');
  // The preview is a full document; show only its body inside the page, with the template styles.
  const body = preview.html.replace(/^[\s\S]*<body[^>]*>/, '').replace(/<\/body>[\s\S]*$/, '');
  const styles = /<style>([\s\S]*?)<\/style>/.exec(preview.html)?.[1] ?? '';
  return (
    <>
      <Breadcrumbs
        items={[
          { label: t('kicker'), href: '/system/school' },
          { label: t('title'), href: '/system/templates' },
          { label: template.name },
        ]}
      />
      <PageHeader
        kicker={t('kicker')}
        title={template.name}
        description={`${m(`kinds.${template.kind}`)} · ${m('version')} ${template.version} · ${template.pageWidth} × ${template.pageHeight}`}
      />
      <Notice params={sp} />
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-5)',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
        }}
      >
        <div>
          {canManage ? (
            <Card title={m('edit')}>
              <form action={updateDocumentTemplate}>
                <input type="hidden" name="id" value={template.id} />
                <FormRow columns={2}>
                  <InputField
                    id="name"
                    name="name"
                    label={m('name')}
                    defaultValue={template.name}
                    required
                    maxLength={120}
                  />
                  <SelectField
                    id="status"
                    name="status"
                    label={m('status')}
                    defaultValue={template.status}
                    options={[
                      { value: 'active', label: c('active') },
                      { value: 'inactive', label: c('inactive') },
                    ]}
                  />
                </FormRow>
                <FormRow columns={2}>
                  <InputField
                    id="pageWidth"
                    name="pageWidth"
                    label={m('pageWidth')}
                    defaultValue={template.pageWidth}
                  />
                  <InputField
                    id="pageHeight"
                    name="pageHeight"
                    label={m('pageHeight')}
                    defaultValue={template.pageHeight}
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
                      rows={18}
                      defaultValue={template.bodyHtml}
                      required
                      style={{
                        fontFamily: 'var(--font-mono, monospace)',
                        fontSize: 'var(--fs-small)',
                      }}
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
                      rows={8}
                      defaultValue={template.stylesCss}
                      style={{
                        fontFamily: 'var(--font-mono, monospace)',
                        fontSize: 'var(--fs-small)',
                      }}
                    />
                  </div>
                </FormRow>
                <p className="ep-field__help">
                  <strong>{m('placeholders')}:</strong> {template.placeholders.join(', ')}
                </p>
                <FormActions>
                  <Button type="submit">{m('save')}</Button>
                </FormActions>
              </form>
            </Card>
          ) : null}
          {template.kind !== 'transfer_certificate' ? (
            <Card title={m('render')} style={{ marginTop: 'var(--sp-5)' }}>
              <form
                action={renderTemplateFor}
                style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'flex-end' }}
              >
                <input type="hidden" name="templateId" value={template.id} />
                <input type="hidden" name="entity" value="student" />
                <input type="hidden" name="returnTo" value={`/system/templates/${template.id}`} />
                <InputField
                  id="entityId"
                  name="entityId"
                  label={m('studentId')}
                  required
                  pattern="[0-9]+"
                />
                <FormActions>
                  <Button type="submit" variant="secondary">
                    {m('queue')}
                  </Button>
                </FormActions>
              </form>
            </Card>
          ) : null}
        </div>
        <Card title={m('preview')}>
          <p className="ep-field__help" style={{ marginBottom: 'var(--sp-3)' }}>
            {m('previewHelp')}
          </p>
          <div
            style={{
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              overflow: 'auto',
              background: '#fff',
              maxHeight: 900,
            }}
          >
            <style>{styles.replace(/@page[^}]*}/g, '')}</style>
            <div
              style={{ transform: 'scale(0.75)', transformOrigin: 'top left', width: '133.4%' }}
              dangerouslySetInnerHTML={{ __html: body }}
            />
          </div>
        </Card>
      </div>
    </>
  );
}
