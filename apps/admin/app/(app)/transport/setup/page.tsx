import { Card, PageHeader } from '@edupro/ui';
import { MessageTemplates } from '@/components/MessageTemplates';
import { TransportNav } from '@/components/transport/TransportNav';
import { TransportSetupForm } from '@/components/transport/TransportSetupForm';
import { apiFetch, getMe } from '@/lib/api';
import type { TransportSetup } from '@/lib/transport-desk';

/** Transport settings (admin): the charge rule, the approval levels and the message templates. */
export default async function TransportSetupPage() {
  const [me, setup] = await Promise.all([
    getMe(),
    apiFetch<TransportSetup>('/transport/desk/setup'),
  ]);
  return (
    <>
      <PageHeader
        kicker="Transport"
        title="Transport settings"
        description="How one-way and two-stoppage transport is charged, and who approves a transport request. Transport In-charge and Accountant are roles you give under Access."
        actions={
          <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/masters/transport">
            Routes, stoppages, vehicles
          </a>
        }
      />
      <TransportNav current="/transport/setup" permissions={me.permissions} />
      <Card>
        <TransportSetupForm setup={setup} />
      </Card>
      <MessageTemplates
        templates={setup.templates}
        search="transport"
        builtInEmail="Built-in design"
      />
    </>
  );
}
