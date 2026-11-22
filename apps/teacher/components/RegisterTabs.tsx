import { t, type Lang } from '@/lib/i18n';

export type RegisterTab = 'fill' | 'mark' | 'grade' | 'remark' | 'attendance' | 'health';

/**
 * The Exam register's tabs (docs/design/97): Fill the register (the class teacher's remarks, exam attendance,
 * height and weight), then the registers as the admin's Registers — Mark, Grade, Remark, Attendance and Height &
 * Weight (the last with the health view right) — for the person's own classes and sections.
 */
export function RegisterTabs({
  current,
  permissions,
  lang,
}: {
  current: RegisterTab;
  permissions: string[];
  lang: Lang;
}) {
  const marks = permissions.includes('exams.marks.view');
  const items: Array<{ key: RegisterTab; label: string; href: string; show: boolean }> = [
    { key: 'fill', label: 'Fill the register', href: '/exam-register', show: true },
    { key: 'mark', label: 'Mark Register', href: '/exam-register/mark', show: true },
    { key: 'grade', label: 'Grade Register', href: '/exam-register/grade', show: true },
    { key: 'remark', label: 'Remark Register', href: '/exam-register/remark', show: marks },
    {
      key: 'attendance',
      label: 'Attendance Register',
      href: '/exam-register/attendance',
      show: marks,
    },
    {
      key: 'health',
      label: 'Height & Weight Register',
      href: '/exam-register/health',
      show: marks && permissions.includes('exams.health.view'),
    },
  ];
  return (
    <nav
      className="ep-tabs-links"
      aria-label={t(lang, 'Registers')}
      style={{ marginBottom: 'var(--sp-3)' }}
    >
      {items
        .filter((x) => x.show)
        .map((x) => (
          <a key={x.key} href={x.href} aria-current={x.key === current ? 'page' : undefined}>
            {t(lang, x.label)}
          </a>
        ))}
    </nav>
  );
}
