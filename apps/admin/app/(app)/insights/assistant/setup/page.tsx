import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import type { AssistantSetup } from '@/lib/assistant-setup';
import { AssistantSetupEditor } from './AssistantSetupEditor';

/**
 * Assistant set-up (0410, docs/design/91 phase C): who may use the chatbot, how many questions a person may ask a day,
 * the topics it answers per audience and the starter questions it shows. Reached from the Assistant page.
 */
export default async function AssistantSetupPage() {
  const me = await getMe();
  if (!me.permissions.includes('insights.assistant.audit')) notFound();
  let setup: AssistantSetup;
  try {
    setup = await apiFetch<AssistantSetup>('/insights/assistant/settings');
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) notFound();
    throw e;
  }
  const canEdit = me.permissions.includes('platform.settings.edit');
  return (
    <>
      <Breadcrumbs
        items={[{ label: 'Assistant', href: '/insights/assistant' }, { label: 'Assistant set-up' }]}
      />
      <PageHeader
        kicker="Assistant"
        title="Assistant set-up"
        description="Who may use the chatbot, how many questions a day, the topics it answers and the questions it suggests. It reads only this school's records — no outside AI model."
      />
      {canEdit ? null : (
        <p className="ep-alert ep-alert--info" role="status">
          You can see the set-up; changing it needs the right to edit settings.
        </p>
      )}
      <AssistantSetupEditor initial={setup} canEdit={canEdit} />
    </>
  );
}
