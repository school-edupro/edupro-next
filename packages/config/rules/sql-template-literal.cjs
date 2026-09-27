/**
 * S2-12: SQL is never assembled from template literals with interpolated values. Bound parameters ($1, $2)
 * carry every value; the only accepted interpolations are fixed fragments (a column list constant, a table
 * name chosen from an allow-list) and each of those sites carries a
 * `// eslint-disable-next-line no-restricted-syntax -- <why it is safe>` comment on the line above the
 * template literal, which reviewers treat as a checklist item.
 *
 * The selector matches a template literal that has at least one `${...}` expression and whose static parts
 * contain an upper-case SQL clause keyword. Upper case keeps user-facing messages ("Delete this class?")
 * out of the rule; SQL in this repository is written in upper case.
 */
const SQL_KEYWORDS =
  '(SELECT|INSERT INTO|UPDATE|DELETE FROM|WHERE|JOIN|RETURNING|VALUES|ORDER BY|GROUP BY|LIMIT|OFFSET|CALL|FROM|SET)';

module.exports = {
  // Flat-config globs resolve against each package's own eslint.config.cjs, so this is the package-relative
  // source folder (API, workers, db, etl). Tests are exempt; they seed data pragmatically.
  files: ['src/**/*.ts'],
  selector: `TemplateLiteral[expressions.length>0]:has(> TemplateElement[value.raw=/\\b${SQL_KEYWORDS}\\b/])`,
  message:
    'SQL must not be built from template literals with interpolation. Use bound parameters ($1, $2). If the interpolation is a fixed fragment, add "// eslint-disable-next-line no-restricted-syntax -- <reason>" on the line above the template literal.',
};
