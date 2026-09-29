import { Button, Card, DataTable, FormRow, InputField, PageHeader, SelectField } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { issueCertificates } from '@/lib/actions';
import { apiFetch } from '@/lib/api';
import { sectionOptions } from '@/lib/sections';

interface Template {
  id: string;
  code: string;
  name: string;
  kind: string;
  status: string;
}
interface Certificate {
  id: string;
  student: string;
  admissionNo: string;
  serialNo: string;
  title: string;
  issuedOn: string;
  exportId: string | null;
  exportStatus: string | null;
  template: string;
}

/** Sprint 19: certificates designer (document templates of kind certificate) and bulk generation. */
export default async function CertificatesPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const [t, e, templates, issued, sections] = await Promise.all([
    getTranslations('pages.engagement_certificates'),
    getTranslations('eng19'),
    apiFetch<{ data: Template[] }>('/platform/templates').then((x) =>
      x.data.filter((k) => k.kind === 'certificate' && k.status === 'active'),
    ),
    apiFetch<{ data: Certificate[] }>('/engagement/certificates').then((x) => x.data),
    sectionOptions(),
  ]);
  return (
    <>
      <PageHeader
        kicker={t('kicker')}
        title={t('title')}
        description={t('description')}
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/system/templates">
            Templates
          </a>
        }
      />
      <Notice params={sp} />
      <Card title={e('generate')} style={{ marginBottom: 'var(--sp-4)' }}>
        <form action={issueCertificates}>
          <FormRow columns={3}>
            <SelectField
              id="templateId"
              name="templateId"
              label={e('template')}
              options={templates.map((k) => ({ value: k.id, label: k.name }))}
            />
            <SelectField
              id="classSectionId"
              name="classSectionId"
              label={e('section')}
              options={sections}
            />
            <InputField id="studentIds" name="studentIds" label={e('studentIds')} />
            <InputField id="title" name="title" label={e('certTitle')} required maxLength={160} />
            <InputField id="text" name="text" label={e('certText')} maxLength={1000} />
            <InputField id="issuedOn" name="issuedOn" label={e('issuedOn')} type="date" />
          </FormRow>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button type="submit" disabled={templates.length === 0}>
              {e('generate')}
            </Button>
          </div>
          {templates.length === 0 ? (
            <p className="ep-field__help">
              Create a document template of kind “certificate” under System → Templates first.
            </p>
          ) : null}
        </form>
      </Card>
      <Card>
        <DataTable<Certificate>
          caption={`${t('title')} · ${issued.length}`}
          density="dense"
          columns={[
            { key: 'n', header: e('serial'), render: (c) => <strong>{c.serialNo}</strong> },
            {
              key: 's',
              header: e('student'),
              render: (c) => (
                <>
                  {c.student}
                  <div className="ep-kicker">{c.admissionNo}</div>
                </>
              ),
            },
            {
              key: 't',
              header: e('certTitle'),
              render: (c) => (
                <>
                  {c.title}
                  <div className="ep-kicker">{c.template}</div>
                </>
              ),
            },
            { key: 'd', header: e('issuedOn'), render: (c) => c.issuedOn },
            {
              key: 'p',
              header: e('pdf'),
              render: (c) =>
                c.exportId && c.exportStatus === 'ready' ? (
                  <a href={`/reports/exports/${c.exportId}/download`}>{e('download')}</a>
                ) : (
                  (c.exportStatus ?? '')
                ),
            },
          ]}
          rows={issued}
          rowKey={(c) => c.id}
          emptyTitle={e('noRows')}
        />
      </Card>
    </>
  );
}
