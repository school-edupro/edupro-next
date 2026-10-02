import { apiFetch } from './api';
import type { RuleOptions } from './comms';
import type { ClassRow, Page, SectionRow } from './types';

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

/** Classes, sections (with their class) and master values for rules and pickers (server side). */
export async function loadPickers() {
  const [classes, options] = await Promise.all([
    apiFetch<Page<ClassRow>>('/academics/classes?size=200')
      .then((r) => r.data)
      .catch(() => [] as ClassRow[]),
    apiFetch<RuleOptions>('/comms/groups/rule-options').catch(() => NO_OPTIONS),
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
  return {
    classes: classes.map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` })),
    sections,
    options,
    routes: options.routes.map((r) => ({ value: r.id, label: r.label })),
  };
}
