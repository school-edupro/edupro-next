/**
 * The legacy Registers menu as a switch (docs/design/69): Mark · Grade · Remark · Attendance · Height &
 * Weight (the last only with the health view right). Mark and Grade registers are saved (docs/design/68,
 * 69); the others are reports over what was entered.
 */
export function RegistersSwitch({
  current,
  permissions,
}: {
  current: 'mark' | 'grade' | 'remark' | 'attendance' | 'health';
  permissions: string[];
}) {
  const items = [
    { key: 'mark', label: 'Mark Register', href: '/exams/schemes', show: true },
    { key: 'grade', label: 'Grade Register', href: '/exams/grade-registers', show: true },
    {
      key: 'remark',
      label: 'Remark Register',
      href: '/exams/registers/remark',
      show: permissions.includes('exams.marks.view'),
    },
    {
      key: 'attendance',
      label: 'Attendance Register',
      href: '/exams/registers/attendance',
      show: permissions.includes('exams.marks.view'),
    },
    {
      key: 'health',
      label: 'Height & Weight Register',
      href: '/exams/registers/health',
      show: permissions.includes('exams.marks.view') && permissions.includes('exams.health.view'),
    },
  ].filter((x) => x.show);
  return (
    <nav aria-label="Registers" style={{ marginBottom: 'var(--sp-4)' }}>
      <ul className="ep-xchips">
        {items.map((x) => (
          <li key={x.key} style={{ padding: 0, border: 0, background: 'none' }}>
            <a href={x.href} aria-current={x.key === current ? 'page' : undefined}>
              {x.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
