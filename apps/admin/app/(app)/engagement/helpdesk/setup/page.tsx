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
      <section
        className="ep-card"
        aria-labelledby="hd-family-help"
        style={{ marginBottom: 'var(--sp-4)' }}
      >
        <h2 id="hd-family-help" className="ep-cdash__h3" style={{ marginTop: 0 }}>
          Help for families
        </h2>
        <p className="ep-field__help" style={{ marginTop: 0 }}>
          The questions and answers parents and students see on Help, in the app and on the website.
        </p>
        <ul className="ep-setup-links">
          <li>
            <a href="/engagement/helpdesk/setup/family-help">
              <strong>Help questions and answers</strong>
            </a>
            <span className="ep-field__help" style={{ display: 'block', margin: 0 }}>
              Headings, questions in English and Hindi, who sees each, the screen it is about, and
              how often families found an answer helpful
            </span>
          </li>
        </ul>
      </section>
      <HelpdeskSetup initial={setup} />
      <MessageTemplates
        templates={setup.templates ?? []}
        search="helpdesk"
        builtInEmail="Built-in design"
      />
    </>
  );
}
