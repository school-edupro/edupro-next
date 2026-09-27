import {
  Breadcrumbs,
  Button,
  FormActions,
  FormRow,
  FormSection,
  InputField,
  PageHeader,
  SelectField,
} from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { updateTemplate } from '@/lib/actions';
import { apiFetch } from '@/lib/api';
import type { Template } from '@/lib/types';

export default async function TemplatePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const tp = await getTranslations('pages.comms_templates_detail');
  const { id } = await params;
  const sp = await searchParams;
  const t = await apiFetch<Template>(`/comms/templates/${id}`);
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Communication', href: '/comms/templates' },
          { label: 'Templates', href: '/comms/templates' },
          { label: t.name },
        ]}
      />
      <PageHeader
        kicker={tp('kicker')}
        title={t.name}
        description={
          <>
            <code>{t.code}</code> · {t.channel} · variables: {t.variables.join(', ') || 'none'}
          </>
        }
      />
      <Notice params={sp} />
      <form action={updateTemplate}>
        <input type="hidden" name="id" value={t.id} />
        <FormSection title="Content">
          <FormRow columns={2}>
            <InputField id="name" name="name" label="Name" required defaultValue={t.name} />
            <SelectField
              id="status"
              name="status"
              label="Status"
              defaultValue={t.status}
              options={[
                { value: 'active', label: 'Active' },
                { value: 'inactive', label: 'Inactive' },
              ]}
            />
          </FormRow>
          {t.channel === 'email' ? (
            <FormRow columns={1}>
              <InputField
                id="subject"
                name="subject"
                label="Subject"
                defaultValue={t.subject ?? ''}
                required
              />
            </FormRow>
          ) : null}
          <div className="ep-field">
            <label className="ep-field__label" htmlFor="body">
              Body <span aria-hidden="true">*</span>
            </label>
            <textarea
              id="body"
              name="body"
              className="ep-input"
              rows={5}
              required
              defaultValue={t.body}
            />
          </div>
        </FormSection>
        <FormSection
          title="Provider registration"
          description="DLT ids must match the content template approved by the operator; a mismatch is rejected by the gateway."
        >
          <FormRow columns={3}>
            <InputField
              id="dlt"
              name="dltTemplateId"
              label="DLT template id"
              defaultValue={t.dltTemplateId ?? ''}
              required={t.channel === 'sms'}
            />
            <InputField
              id="entity"
              name="dltEntityId"
              label="DLT entity id"
              defaultValue={t.dltEntityId ?? ''}
            />
            <InputField
              id="sender"
              name="senderId"
              label="Sender id or from address"
              defaultValue={t.senderId ?? ''}
            />
          </FormRow>
        </FormSection>
        <FormActions>
          <Button type="submit">Save template</Button>
          <a className="ep-btn ep-btn--secondary" href="/comms/templates">
            Back
          </a>
        </FormActions>
      </form>
    </>
  );
}
