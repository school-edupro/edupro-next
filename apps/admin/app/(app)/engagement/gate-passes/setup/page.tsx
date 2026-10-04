import { Card, PageHeader } from '@edupro/ui';
import { GatePassNav } from '@/components/gate-passes/GatePassNav';
import { GatePassSetupForm } from '@/components/gate-passes/GatePassSetupForm';
import { MessageTemplates } from '@/components/MessageTemplates';
import { apiFetch, getMe } from '@/lib/api';
import type { GatePassSetup } from '@/lib/gate-passes';

/** Gate pass set-up (admin): approval levels for pupil and staff passes, and the hand-over rules. */
export default async function GatePassSetupPage() {
  const [me, setup] = await Promise.all([getMe(), apiFetch<GatePassSetup>('/gate-passes/setup')]);
  return (
    <>
      <PageHeader
        kicker="Gate passes"
        title="Set-up"
        description="Who approves a gate pass and in which order. Front Desk and Gate / Security are roles you give under Access."
      />
      <GatePassNav current="/engagement/gate-passes/setup" permissions={me.permissions} />
      <Card>
        <GatePassSetupForm setup={setup} />
      </Card>
      <MessageTemplates
        templates={setup.templates}
        search="gate pass"
        builtInEmail="Built-in design (QR and PDF)"
      />
    </>
  );
}
