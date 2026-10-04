import { Button, PageHeader } from '@edupro/ui';
import { MessageTemplates, type TemplateStatus } from '@/components/MessageTemplates';
import { Notice } from '@/components/Notice';
import { HelpdeskSetup } from '@/components/helpdesk/HelpdeskSetup';
import { apiFetch } from '@/lib/api';
import type { Setup } from '@/lib/helpdesk';
import { escalateNow } from '@/lib/helpdesk-actions';

/** Helpdesk set-up (admin): working hours, the ERP provider, query types, owners, SLA and escalation. */
export default async function HelpdeskSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const setup = await apiFetch<Setup & { templates?: TemplateStatus[] }>('/helpdesk/setup');
  return (
    <>
      <PageHeader
        kicker="Helpdesk"
        title="Helpdesk set-up"
        description="Who answers each type of query, how long they have, and who it goes to next when it is not resolved. The check runs every five minutes."
        actions={
          <form action={escalateNow}>
            <Button type="submit" variant="ghost" size="sm">
              Run the escalation check now
            </Button>
          </form>
        }
      />
      {sp.ok === 'escalated' ? (
        <p className="ep-alert ep-alert--success">Escalation check done: {sp.detail}.</p>
      ) : (
        <Notice params={sp} />
      )}
      <HelpdeskSetup initial={setup} />
      <MessageTemplates
        templates={setup.templates ?? []}
        search="helpdesk"
        builtInEmail="Built-in design"
      />
    </>
  );
}
