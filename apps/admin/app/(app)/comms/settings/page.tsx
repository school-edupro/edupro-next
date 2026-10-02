import { PageHeader } from '@edupro/ui';
import { CommsSettingsForm } from '@/components/comms/CommsSettingsForm';
import { apiFetch, getMe } from '@/lib/api';
import type { Balance, CommsSettings } from '@/lib/comms';

/** Communication settings (v2): SMS / WhatsApp / email providers, approval rule, quiet hours, credits. */
export default async function CommsSettingsPage() {
  const [me, settings, credits, wa] = await Promise.all([
    getMe(),
    apiFetch<CommsSettings>('/comms/settings'),
    apiFetch<{
      balances: Balance[];
      ledger: Array<{
        id: string;
        channel: string;
        units: number;
        amount: number | null;
        note: string | null;
        onDate: string;
        by: string | null;
      }>;
    }>('/comms/credits').catch(() => ({ balances: [], ledger: [] })),
    apiFetch<{ data: Array<{ id: string; name: string; waTemplateName: string | null }> }>(
      '/comms/templates?channel=whatsapp&status=active',
    )
      .then((r) => r.data.filter((t) => t.waTemplateName))
      .catch(() => []),
  ]);
  return (
    <>
      <PageHeader
        kicker="Communication"
        title="Communication settings"
        description="The school’s own SMS (smsbhejo or MSG91), WhatsApp (EMS bridge or Meta) and email (SMTP / Amazon SES) accounts, switched on or off per channel,, who needs approval, quiet hours, attachment size, rates and credits. Keys are stored encrypted and never shown again."
      />
      <CommsSettingsForm
        settings={settings}
        credits={credits}
        canCredit={me.permissions.includes('comms.credit.manage')}
        whatsappTemplates={wa.map((t) => ({ id: t.id, name: t.name }))}
      />
    </>
  );
}
