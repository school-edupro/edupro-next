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
  toneForStatus,
} from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { createTemplate } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type { Template } from '@/lib/types';

export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const t = await getTranslations('pages.comms_templates');
  const sp = await searchParams;
  const [me, templates] = await Promise.all([
    getMe(),
    apiFetch<{ data: Template[] }>('/comms/templates'),
  ]);
  const canManage = me.permissions.includes('comms.template.manage');
  return (
    <>
      <PageHeader
        kicker={t('kicker')}
        title={t('title')}
        description="One template per channel and code. SMS templates carry the DLT ids registered with the telecom operator; placeholders look like {{student_name}}."
      />
      <Notice params={sp} />
      <Card>
        <DataTable<Template>
          caption="Templates"
          columns={[
            {
              key: 'name',
              header: 'Template',
              render: (t) =>
                canManage ? <a href={`/comms/templates/${t.id}`}>{t.name}</a> : t.name,
            },
            { key: 'code', header: 'Code', render: (t) => <code>{t.code}</code> },
            { key: 'channel', header: 'Channel', render: (t) => t.channel },
            { key: 'vars', header: 'Variables', render: (t) => t.variables.join(', ') },
            { key: 'dlt', header: 'DLT template', render: (t) => t.dltTemplateId ?? '' },
            {
              key: 'status',
              header: 'Status',
              render: (t) => <Badge tone={toneForStatus(t.status)}>{t.status}</Badge>,
            },
          ]}
          rows={templates.data}
          rowKey={(t) => t.id}
          emptyTitle="No templates yet"
        />
      </Card>
      {canManage ? (
        <form action={createTemplate} style={{ marginTop: 'var(--sp-5)' }}>
          <FormSection
            title="New template"
            description="Variables are read from the body and subject automatically."
          >
            <FormRow columns={3}>
              <InputField
                id="t-code"
                name="code"
                label="Code"
                required
                pattern="[a-z][a-z0-9_]{1,59}"
                placeholder="fee_due"
              />
              <SelectField
                id="t-channel"
                name="channel"
                label="Channel"
                options={[
                  { value: 'sms', label: 'SMS' },
                  { value: 'whatsapp', label: 'WhatsApp' },
                  { value: 'email', label: 'Email' },
                  { value: 'push', label: 'Push' },
                ]}
              />
              <InputField
                id="t-name"
                name="name"
                label="Name"
                required
                placeholder="Fee reminder"
              />
            </FormRow>
            <FormRow columns={1}>
              <InputField
                id="t-subject"
                name="subject"
                label="Subject (email)"
                placeholder="Fee reminder for {{student_name}}"
              />
            </FormRow>
            <div className="ep-field">
              <label className="ep-field__label" htmlFor="t-body">
                Body <span aria-hidden="true">*</span>
              </label>
              <textarea
                id="t-body"
                name="body"
                className="ep-input"
                rows={4}
                required
                placeholder="Dear {{guardian_name}}, fees of {{amount}} for {{student_name}} are due on {{due_date}}."
              />
            </div>
            <FormRow columns={3}>
              <InputField
                id="t-dlt"
                name="dltTemplateId"
                label="DLT template id"
                help="Required for SMS"
              />
              <InputField id="t-entity" name="dltEntityId" label="DLT entity id" />
              <InputField
                id="t-sender"
                name="senderId"
                label="Sender id or from address"
                placeholder="EDUPRO"
              />
            </FormRow>
          </FormSection>
          <FormActions>
            <Button type="submit">Create template</Button>
          </FormActions>
        </form>
      ) : null}
    </>
  );
}
