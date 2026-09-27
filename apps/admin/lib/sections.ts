import { apiFetch } from './api';
import type { ClassRow, Page, SectionRow } from './types';

/** Section options of the working year as "VI-A" labels for selects. */
export async function sectionOptions(): Promise<Array<{ value: string; label: string }>> {
  const classes = await apiFetch<Page<ClassRow>>('/academics/classes?size=200').catch(() => ({
    data: [] as ClassRow[],
    page: { number: 1, size: 0, total: 0 },
  }));
  const all = await Promise.all(
    classes.data.map((c) =>
      apiFetch<{ data: SectionRow[] }>(`/academics/classes/${c.id}/sections`)
        .then((r) => r.data.map((s) => ({ value: s.id, label: `${c.code}-${s.name}` })))
        .catch(() => []),
    ),
  );
  return all.flat();
}
