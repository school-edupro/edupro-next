import { Badge, Card, PageHeader, toneForStatus } from '@edupro/ui';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import { CHANNEL_LABEL, type Channel, type CommsTemplate } from '@/lib/comms';

const TABS: Array<{ id: Channel; label: string; help: string }> = [
  {
    id: 'sms',
    label: 'SMS',
    help: 'Registered on DLT with the telecom operator; the text must match it.',
  },
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    help: 'Approved by Meta; parameters fill {{1}}, {{2}}… in order.',
  },
  {
    id: 'email',
    label: 'Email',
    help: 'Written in the HTML editor; the school’s frame is added when sent.',
  },
];

/** Template master (communication v2): SMS, WhatsApp and email templates by channel. */
export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string; channel?: string }>;
}) {
  const sp = await searchParams;
  const channel = (TABS.some((t) => t.id === sp.channel) ? sp.channel : 'sms') as Channel;
  const [me, all] = await Promise.all([
    getMe(),
    apiFetch<{ data: CommsTemplate[] }>('/comms/templates').then((r) => r.data),
  ]);
  const canManage = me.permissions.includes('comms.template.manage');
  const rows = all.filter((t) => t.channel === channel);
  const tab = TABS.find((t) => t.id === channel)!;
  return (
    <>
      <PageHeader
        kicker="Communication"
        title="Template master"
        description="SMS, WhatsApp and email templates with variables such as {{student_name}}, {{class}} and {{fee_due}}."
        actions={
          canManage ? (
            <a className="ep-btn ep-btn--primary" href={`/comms/templates/new?channel=${channel}`}>
              New {CHANNEL_LABEL[channel]} template
            </a>
          ) : undefined
        }
      />
      <Notice params={sp} />
      <nav className="ep-tabs__list" aria-label="Channels">
        {TABS.map((t) => (
          <a
            key={t.id}
            className="ep-tabs__tab"
            href={`/comms/templates?channel=${t.id}`}
            aria-current={t.id === channel ? 'page' : undefined}
          >
            {t.label} ({all.filter((x) => x.channel === t.id).length})
          </a>
        ))}
      </nav>
      <Card>
        <p className="ep-field__help" style={{ marginTop: 0 }}>
          {tab.help}
        </p>
        {rows.length ? (
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Scrollable table">
            <table className="ep-table">
              <caption className="ep-sr-only">{tab.label} templates</caption>
              <thead>
                <tr>
                  <th scope="col">Template</th>
                  <th scope="col">Code</th>
                  <th scope="col">
                    {channel === 'sms'
                      ? 'DLT id'
                      : channel === 'whatsapp'
                        ? 'Meta name'
                        : 'Subject'}
                  </th>
                  <th scope="col">Variables</th>
                  <th scope="col">Type</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <a href={`/comms/templates/${t.id}`}>{t.name}</a>
                    </td>
                    <td>
                      <code>{t.code}</code>
                    </td>
                    <td>
                      {channel === 'sms'
                        ? (t.dltTemplateId ?? '—')
                        : channel === 'whatsapp'
                          ? (t.waTemplateName ?? '—')
                          : (t.subject ?? '—')}
                    </td>
                    <td className="ep-field__help">
                      {t.variables.map((v) => `{{${v}}}`).join(' ')}
                    </td>
                    <td>{t.category === 'service' ? 'Important' : 'General'}</td>
                    <td>
                      <Badge tone={toneForStatus(t.status)}>{t.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="ep-field__help">No {tab.label} templates yet.</p>
        )}
      </Card>
    </>
  );
}
