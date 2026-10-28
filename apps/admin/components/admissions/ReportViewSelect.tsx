'use client';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

/**
 * The score report's Report filter (docs/design/62): Merit list, Written test result, Interview
 * result; it applies as soon as one is chosen, keeping the other filters. A result the class has no
 * stage for is shown, not offered.
 */
export function ReportViewSelect({
  value,
  options,
  query,
}: {
  value: string;
  options: Array<{ value: string; label: string; disabled?: boolean }>;
  /** the page's other filters */
  query: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <label className="ep-field">
      <span className="ep-field__label">Report</span>
      <select
        className="ep-select"
        value={value}
        disabled={pending}
        onChange={(e) =>
          start(() => {
            const q = new URLSearchParams(query);
            q.delete('view');
            if (e.target.value !== 'merit') q.set('view', e.target.value);
            router.push(`/admissions/score-report?${q.toString()}`);
          })
        }
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
