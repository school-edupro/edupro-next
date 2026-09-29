/**
 * Sprint 20: in-app tours per screen. Each tour is a list of message keys under `tours.<id>.<n>_title`
 * and `tours.<id>.<n>_body`; the Shell picks the tour whose prefix matches the current path (longest
 * prefix wins) and passes the translated steps to the client component.
 */
export interface TourDefinition {
  id: string;
  prefix: string;
  steps: number;
}

export const TOURS: TourDefinition[] = [
  { id: 'home', prefix: '/', steps: 4 },
  { id: 'students', prefix: '/people/students', steps: 4 },
  { id: 'admissions', prefix: '/admissions', steps: 4 },
  { id: 'academics', prefix: '/academics', steps: 4 },
  { id: 'attendance', prefix: '/attendance', steps: 3 },
  { id: 'communication', prefix: '/communication', steps: 4 },
  { id: 'engagement', prefix: '/engagement', steps: 4 },
  { id: 'fees', prefix: '/fees', steps: 5 },
  { id: 'exams', prefix: '/exams', steps: 4 },
  { id: 'workflow', prefix: '/workflow', steps: 3 },
  { id: 'reports', prefix: '/reports', steps: 3 },
  { id: 'masters', prefix: '/masters', steps: 3 },
  { id: 'privacy', prefix: '/system/privacy', steps: 4 },
];

export function tourFor(path: string): TourDefinition | null {
  let best: TourDefinition | null = null;
  for (const t of TOURS) {
    const hit =
      t.prefix === '/' ? path === '/' : path === t.prefix || path.startsWith(`${t.prefix}/`);
    if (hit && (!best || t.prefix.length > best.prefix.length)) best = t;
  }
  return best;
}
