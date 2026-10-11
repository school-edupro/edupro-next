import type { Me } from '@edupro/bff';

/**
 * The right each portal screen needs. The school decides what a login may open through its roles
 * (a withdrawn pupil's "Former student / parent" role keeps only a few), so the menu, the phone tab bar
 * and the home tiles all ask here. Screens not listed are open to every signed-in family.
 */
const NEEDS: Record<string, string> = {
  '/profile': 'engagement.family.view',
  '/attendance': 'attendance.session.view',
  '/timetable': 'academics.timetable.view',
  '/teachers': 'academics.daily_work.view',
  '/homework': 'academics.daily_work.view',
  '/documents': 'academics.daily_work.view',
  '/results': 'exams.family.view',
  '/health': 'engagement.family.view',
  '/certificates': 'engagement.family.view',
  '/notices': 'academics.notice.view',
  '/calendar': 'academics.calendar.view',
  '/directory': 'academics.daily_work.view',
  '/transport': 'transport.request.view',
  '/library': 'library.family.view',
  '/fees': 'fees.family.view',
  '/queries': 'engagement.query.create',
  '/appointments': 'engagement.family.view',
  '/gate-passes': 'engagement.family.view',
  '/consents': 'engagement.family.view',
  '/assistant': 'insights.assistant.use',
};

export function canOpen(me: Me, href: string): boolean {
  const need = NEEDS[href];
  return !need || me.permissions.includes(need);
}
