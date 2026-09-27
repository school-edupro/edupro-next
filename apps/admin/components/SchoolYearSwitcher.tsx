import type { Me } from '@/lib/api';

/**
 * School switcher in the header. Posts to /api/context, which validates membership and sets the context
 * cookie. Progressive enhancement: works without client JavaScript.
 */
export function SchoolYearSwitcher({ me }: { me: Me }) {
  if (me.memberships.length <= 1) {
    const only = me.memberships[0];
    return (
      <span
        style={{
          fontFamily: 'var(--font-heading)',
          fontWeight: 'var(--fw-semibold)',
          color: 'var(--text-heading)',
        }}
      >
        {only?.schoolName ?? 'No school'}
      </span>
    );
  }
  return (
    <form
      method="post"
      action="/api/context"
      style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}
    >
      <label htmlFor="schoolId" className="ep-field__label" style={{ margin: 0 }}>
        School
      </label>
      <select
        id="schoolId"
        name="schoolId"
        className="ep-select"
        defaultValue={me.school?.id ?? ''}
        style={{ minHeight: '36px' }}
      >
        {me.memberships.map((m) => (
          <option key={m.schoolId} value={m.schoolId}>
            {m.schoolName}
          </option>
        ))}
      </select>
      <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
        Switch
      </button>
    </form>
  );
}
