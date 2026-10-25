import type { CategoryGap } from '@/lib/admission-setup';

/**
 * Fee categories a session's form cannot decide (docs/design/43, part 5): the questions they need are
 * not on the form, so those families are charged the default category's fee until the office changes
 * it at Document check. Shown on the session's Fee tab and in Admission set-up.
 */
export function CategoryGapsNote({
  gaps,
  withSession = false,
}: {
  gaps: CategoryGap[];
  /** Admission set-up lists every session not closed */
  withSession?: boolean;
}) {
  if (!gaps.length) return null;
  const never = gaps.some((g) => g.never);
  return (
    <div
      className={`ep-alert ${never ? 'ep-alert--warning' : 'ep-alert--info'} ep-catgaps`}
      role="note"
      aria-label="Fee categories the form cannot decide"
    >
      <strong>
        {never
          ? 'Some fee categories can never apply: their questions are not on the form.'
          : 'Some fee categories can apply only one way: part of their questions is not on the form.'}
      </strong>
      <ul>
        {gaps.map((g) => (
          <li key={`${g.cycleId}-${g.formId}-${g.categoryId}`}>
            <strong>{g.categoryName}</strong>
            {withSession ? ` · ${g.cycleName}` : ''}: the form &ldquo;{g.formName}&rdquo; (
            {g.classes.join(', ')}) does not ask{' '}
            {g.missing.map((m, i) => (
              <span key={m}>
                {i ? ', ' : ''}
                <code>{m}</code>
              </span>
            ))}
            {g.never ? ' — every family on it pays the default fee.' : '.'}
          </li>
        ))}
      </ul>
      <span className="ep-field__help">
        Add those questions to the form in Registration forms (with the same keys), or change the
        category&rsquo;s conditions in Admission set-up. Until then the office can set the category
        at Document check, after the registration fee was charged.
      </span>
    </div>
  );
}
