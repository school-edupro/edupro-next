import { PageHeader } from '@edupro/ui';
import { Compose } from '@/components/comms/Compose';
import { apiFetch } from '@/lib/api';
import type { CommsTemplate, Group, RuleOptions, TemplateVariable } from '@/lib/comms';
import type { ClassRow, Page, SectionRow } from '@/lib/types';

const NO_OPTIONS: RuleOptions = {
  houses: [],
  categories: [],
  genders: ['male', 'female', 'other'],
  streams: [],
  religions: [],
  departments: [],
  designations: [],
  employeeTypes: [],
  routes: [],
};

/**
 * Compose (communication v2): SMS, WhatsApp and email in one go, to sections, classes, master-wise
 * filters, groups, chosen people, an Excel list or everyone, with a preview of reach, units and cost.
 */
export default async function ComposePage() {
  const [templates, variables, classes, groups, ruleOptions, limits] = await Promise.all([
    apiFetch<{ data: CommsTemplate[] }>('/comms/templates?status=active').then((r) =>
      r.data.filter((x) => x.channel !== 'push'),
    ),
    apiFetch<{ data: TemplateVariable[] }>('/comms/templates/variables')
      .then((r) => r.data)
      .catch(() => [] as TemplateVariable[]),
    apiFetch<Page<ClassRow>>('/academics/classes?size=200').then((r) => r.data),
    apiFetch<{ data: Group[] }>('/comms/groups')
      .then((r) => r.data)
      .catch(() => [] as Group[]),
    apiFetch<RuleOptions>('/comms/groups/rule-options').catch(() => NO_OPTIONS),
    apiFetch<{ attachmentMaxMb: number }>('/comms/requests/limits').catch(() => ({
      attachmentMaxMb: 5,
    })),
  ]);
  const sections = (
    await Promise.all(
      classes.map((c) =>
        apiFetch<{ data: SectionRow[] }>(`/academics/classes/${c.id}/sections`)
          .then((r) =>
            r.data.map((s) => ({ value: s.id, label: `${c.code}-${s.name}`, classId: c.id })),
          )
          .catch(() => []),
      ),
    )
  ).flat();
  return (
    <>
      <PageHeader
        kicker="Communication"
        title="Compose"
        description="Write once and send by SMS, WhatsApp and email to sections, classes, master-wise filters, groups, chosen people or an Excel list."
      />
      <Compose
        templates={templates}
        variables={variables}
        classes={classes.map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))}
        sections={sections}
        routes={ruleOptions.routes.map((r) => ({ value: r.id, label: r.label }))}
        groups={groups}
        ruleOptions={ruleOptions}
        attachmentMaxMb={limits.attachmentMaxMb}
      />
    </>
  );
}
