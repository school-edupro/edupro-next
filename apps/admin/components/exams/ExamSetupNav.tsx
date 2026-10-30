/** Exam set-up is one menu entry; these tabs are its screens. Each thing is set in one place only. */
const TABS: Array<{ href: string; label: string }> = [
  { href: '/exams/masters', label: 'Types, grade scales, marks codes' },
  { href: '/exams/indicators', label: 'Indicators and HPC' },
  { href: '/exams/remarks', label: 'Remark categories and bank' },
];

export function ExamSetupNav({ current }: { current: string }) {
  return (
    <nav
      className="ep-tabs-links ep-tabs__list--wrap"
      aria-label="Exam setup"
      style={{ marginBottom: 'var(--sp-4)', flexWrap: 'wrap' }}
    >
      {TABS.map((t) => (
        <a key={t.href} href={t.href} aria-current={t.href === current ? 'page' : undefined}>
          {t.label}
        </a>
      ))}
    </nav>
  );
}
