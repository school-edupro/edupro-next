import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { TemplateEditor } from '@/components/comms/TemplateEditor';
import { apiFetch, getMe } from '@/lib/api';
import { CHANNEL_LABEL, type Channel, type TemplateVariable } from '@/lib/comms';

export default async function NewTemplatePage({
  searchParams,
}: {
  searchParams: Promise<{ channel?: string }>;
}) {
  const sp = await searchParams;
  const channel = (
    ['sms', 'whatsapp', 'email'].includes(sp.channel ?? '') ? sp.channel : 'sms'
  ) as Channel;
  const [me, variables] = await Promise.all([
    getMe(),
    apiFetch<{ data: TemplateVariable[] }>('/comms/templates/variables').then((r) => r.data),
  ]);
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Communication', href: '/comms' },
          { label: 'Template master', href: `/comms/templates?channel=${channel}` },
          { label: `New ${CHANNEL_LABEL[channel]} template` },
        ]}
      />
      <PageHeader kicker="Template master" title={`New ${CHANNEL_LABEL[channel]} template`} />
      <TemplateEditor
        template={null}
        channel={channel}
        variables={variables}
        canManage={me.permissions.includes('comms.template.manage')}
      />
    </>
  );
}
