import { Badge, Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { sectionsFor, type SettingRow } from '@/lib/settings-sections';
import { SettingsForm } from '../[section]/SettingsForm';
import type { AiModelView } from './actions';
import { AiModelPanel } from './AiModelPanel';

/**
 * School settings → AI model (LLM) (docs/design/101): the AI model for all schools — its address, token, reply
 * field, time limit, on / off and a test, for holders of the right "AI model for all schools" (given by Mobilise);
 * for everyone else whether one is set up — then this school's own choice (AI reports) and the assistant's switches.
 */
export default async function AiModelSettingsPage() {
  const me = await getMe();
  if (!me.permissions.includes('platform.settings.view')) notFound();
  let rows: SettingRow[];
  let view: AiModelView;
  try {
    [rows, view] = await Promise.all([
      apiFetch<{ data: SettingRow[] }>('/platform/settings').then((r) => r.data),
      apiFetch<AiModelView>('/platform/ai-model'),
    ]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) notFound();
    throw e;
  }
  const section = sectionsFor(rows).find((s) => s.id === 'ai-model');
  if (!section) notFound();
  const canEdit = me.permissions.includes('platform.settings.edit');
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const status = view.configured
    ? view.on
      ? { tone: 'success' as const, text: 'On' }
      : { tone: 'neutral' as const, text: 'Off' }
    : { tone: 'neutral' as const, text: 'Not set up' };
  return (
    <>
      <Breadcrumbs
        items={[{ label: 'School settings', href: '/system/settings' }, { label: section.title }]}
      />
      <PageHeader
        kicker="School settings"
        title="AI model (LLM)"
        description="An AI model of our own for all schools: it helps the assistant with the questions EduPro’s own rules cannot answer, and writes the AI reports — in each school only once that school switches it on."
        actions={<Badge tone={status.tone}>{status.text}</Badge>}
      />
      <section className="ep-card" aria-labelledby="aim-all-h">
        <h2 id="aim-all-h" className="ep-card__title">
          For all schools
        </h2>
        {view.canManage ? (
          <AiModelPanel settings={view.settings} />
        ) : (
          <p style={{ margin: 0 }}>
            {view.configured
              ? view.on
                ? 'An AI model is set up for all schools and is on.'
                : 'An AI model is set up for all schools; it is switched off for now.'
              : 'No AI model is set up for the schools yet.'}{' '}
            <span className="ep-field__help" style={{ display: 'block' }}>
              Its address and token are set by people Mobilise gives the right “AI model for all
              schools”.
            </span>
          </p>
        )}
      </section>
      <h2 className="ep-form-section__title" style={{ marginTop: 'var(--sp-5)' }}>
        This school
      </h2>
      <SettingsForm
        sectionTitle={section.title}
        advanced={false}
        fields={section.fields}
        rows={section.fields.map((f) => byKey.get(f.setting)).filter((r): r is SettingRow => !!r)}
        roles={[]}
        canEdit={canEdit}
      />
      <section
        className="ep-card"
        aria-labelledby="aim-asst-h"
        style={{ marginTop: 'var(--sp-4)' }}
      >
        <h2 id="aim-asst-h" className="ep-card__title">
          The assistant
        </h2>
        <p style={{ margin: 0 }}>
          Help from the AI model for the assistant is switched on or off for teachers and office
          staff in{' '}
          <a href="/insights/assistant/setup" style={{ textDecoration: 'underline' }}>
            Assistant set-up
          </a>
          . Questions EduPro’s own rules answer never go to the model.
        </p>
      </section>
    </>
  );
}
