/** The academics screens' own tab bar: the same on every page of the module; only what the role may open. */
const TABS: Array<{ href: string; label: string; permission: string }> = [
  { href: '/academics', label: 'Dashboard', permission: 'academics.daily_work.view' },
  { href: '/academics/daily-work', label: 'Daily work', permission: 'academics.daily_work.view' },
  {
    href: '/academics/documents',
    label: 'Class documents',
    permission: 'academics.daily_work.view',
  },
  { href: '/academics/calendar', label: 'Calendar', permission: 'academics.calendar.view' },
  { href: '/academics/timetable', label: 'Timetable', permission: 'academics.timetable.view' },
  {
    href: '/academics/substitutions',
    label: 'Substitutions',
    permission: 'academics.substitution.view',
  },
  {
    href: '/academics/lesson-plans',
    label: 'Lesson plans',
    permission: 'academics.lesson_plan.view',
  },
  { href: '/academics/syllabus', label: 'Syllabus', permission: 'academics.lesson_plan.view' },
  {
    href: '/academics/syllabus/coverage',
    label: 'Syllabus coverage',
    permission: 'academics.syllabus.report',
  },
  {
    href: '/academics/teacher-assignments',
    label: 'Teacher assignments',
    permission: 'academics.teacher_assignment.view',
  },
  { href: '/academics/gallery', label: 'Gallery', permission: 'academics.gallery.view' },
  { href: '/masters/academics', label: 'Setup', permission: 'academics.class.view' },
  { href: '/academics/settings', label: 'Settings', permission: 'academics.subject.manage' },
];

export function AcademicsNav({ current, permissions }: { current: string; permissions: string[] }) {
  return (
    <nav
      className="ep-tabs-links ep-tabs__list--wrap"
      aria-label="Academics"
      style={{ marginBottom: 'var(--sp-4)', flexWrap: 'wrap' }}
    >
      {TABS.filter((t) => permissions.includes(t.permission)).map((t) => (
        <a key={t.href} href={t.href} aria-current={t.href === current ? 'page' : undefined}>
          {t.label}
        </a>
      ))}
    </nav>
  );
}
