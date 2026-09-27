import type { Me } from '@/lib/api';

/**
 * School and academic-year switcher in the header. Posts to /api/context, which validates the school
 * membership and sets the context cookie; the API reads the year from X-Academic-Year-Id and falls back
 * to the active year. Progressive enhancement: works without client JavaScript.
 */
export async function SchoolYearSwitcher({ me }: { me: Me }) {
  const years = me.academicYears ?? [];
  const currentYear = years.find((y) => y.id === me.academicYear?.id);
  const single = me.memberships.length <= 1;
  return (
    <form
      method="post"
      action="/api/context"
      style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', flexWrap: 'wrap' }}
    >
      {single ? (
        <span
          style={{
            fontFamily: 'var(--font-heading)',
            fontWeight: 'var(--fw-semibold)',
            color: 'var(--text-heading)',
          }}
        >
          {me.memberships[0]?.schoolName ?? 'No school'}
        </span>
      ) : (
        <>
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
        </>
      )}
      {years.length ? (
        <>
          <label htmlFor="academicYearId" className="ep-field__label" style={{ margin: 0 }}>
            Year
          </label>
          <select
            id="academicYearId"
            name="academicYearId"
            className="ep-select"
            defaultValue={currentYear?.id ?? ''}
            style={{ minHeight: '36px' }}
            aria-describedby="year-status"
          >
            {years.map((y) => (
              <option key={y.id} value={y.id}>
                {y.code}
                {y.status === 'active'
                  ? ' · active'
                  : y.status === 'planned'
                    ? ' · planned'
                    : ` · ${y.status}`}
              </option>
            ))}
          </select>
          <span id="year-status" className="ep-kicker" style={{ margin: 0 }}>
            {currentYear
              ? currentYear.status === 'active'
                ? ''
                : `viewing ${currentYear.status} year`
              : ''}
          </span>
        </>
      ) : null}
      {!single || years.length ? (
        <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
          Switch
        </button>
      ) : null}
    </form>
  );
}
