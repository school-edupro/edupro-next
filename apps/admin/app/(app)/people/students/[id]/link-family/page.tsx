import { Badge, Button, Card, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { familyLink } from '@/lib/actions';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import type { FamilyChild, FamilyParent, FamilyPreview } from '@/lib/types';

const RELATION = { father: 'Father', mother: 'Mother' } as const;

const childLine = (c: FamilyChild) => `${c.admissionNo}${c.section ? ` · ${c.section}` : ''}`;

/** One parent record as the office sees it: name, mobile or e-mail, a login, how many children hang off it. */
function Record({ p }: { p: FamilyParent | null }) {
  if (!p) return <span className="ep-field__help">No record</span>;
  return (
    <span>
      <strong>{p.name}</strong>
      <span className="ep-field__help"> {p.mobile ?? p.email ?? ''}</span>{' '}
      {p.hasLogin ? <Badge tone="info">Has a login</Badge> : null}
      <span className="ep-field__help">
        {' '}
        · {p.children} {p.children === 1 ? 'child' : 'children'}
      </span>
    </span>
  );
}

/**
 * Link families (0426): the student's Sibling section names a sibling who hangs off other father / mother records, so
 * a parent's login sees one child. For the father and the mother the office keeps one record for both (or leaves them
 * apart); the other child's link moves to it. Undo on the student's page puts it back.
 */
export default async function LinkFamilyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('people.guardian.edit') || !/^\d{1,18}$/.test(id)) notFound();
  const back = `/people/students/${id}?tab=profile`;
  let preview: FamilyPreview | null = null;
  let problem: string | null = null;
  try {
    preview = await apiFetch<FamilyPreview>(`/people/students/${id}/family-link`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404)
      problem =
        error.problem.type === 'family.no_sibling'
          ? 'No sibling on record. Enter the sibling admission number in the Sibling section of the full profile first.'
          : 'Student not found.';
    else throw error;
  }
  if (!preview)
    return (
      <>
        <PageHeader kicker="Students" title="Link families" />
        <div className="ep-alert ep-alert--warning" role="status">
          {problem}
        </div>
        <p>
          <a href={back} style={{ textDecoration: 'underline' }}>
            Back to the student
          </a>
        </p>
      </>
    );
  const { student, sibling, relations } = preview;
  const name = (side: 'here' | 'sibling') => (side === 'here' ? student : sibling).admissionNo;
  const todo = relations.filter((r) => r.state !== 'shared' && r.state !== 'none');
  return (
    <>
      <PageHeader
        kicker="Students"
        title="Link families"
        description={`${student.name} (${childLine(student)}) and ${sibling.name} (${childLine(sibling)}) are entered as siblings. A parent's login sees the children of its own parent record: keep one father and one mother record for both, and the parent sees both children in the app and on the family website.`}
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href={back}>
            Back to the student
          </a>
        }
      />
      <Notice params={sp} />
      <Card>
        <form action={familyLink}>
          <input type="hidden" name="id" value={student.id} />
          <input type="hidden" name="siblingId" value={sibling.id} />
          {relations.map((r) => (
            <fieldset
              key={r.relation}
              style={{
                border: 0,
                borderBottom: '1px solid var(--border-subtle)',
                padding: 'var(--sp-3) 0',
                margin: 0,
              }}
            >
              <legend className="ep-field__label" style={{ fontSize: 'var(--fs-h4)' }}>
                {RELATION[r.relation]}
              </legend>
              <dl style={{ margin: 'var(--sp-2) 0' }}>
                <dt className="ep-field__help">{childLine(student)}</dt>
                <dd style={{ margin: '0 0 var(--sp-2)' }}>
                  <Record p={r.here} />
                </dd>
                <dt className="ep-field__help">{childLine(sibling)}</dt>
                <dd style={{ margin: 0 }}>
                  <Record p={r.sibling} />
                </dd>
              </dl>
              {r.state === 'shared' ? (
                <p className="ep-field__help" style={{ margin: 0 }}>
                  Already one record for both children.
                  <input type="hidden" name={r.relation} value="apart" />
                </p>
              ) : r.state === 'none' ? (
                <p className="ep-field__help" style={{ margin: 0 }}>
                  Neither child has one.
                  <input type="hidden" name={r.relation} value="apart" />
                </p>
              ) : (
                <>
                  {(r.state === 'different'
                    ? (['here', 'sibling', 'apart'] as const)
                    : r.state === 'only_here'
                      ? (['here', 'apart'] as const)
                      : (['sibling', 'apart'] as const)
                  ).map((v) => (
                    <label key={v} style={{ display: 'block', marginTop: 'var(--sp-2)' }}>
                      <input
                        type="radio"
                        name={r.relation}
                        value={v}
                        defaultChecked={r.suggested === v}
                      />{' '}
                      {v === 'apart'
                        ? 'Leave them apart'
                        : r.state === 'different'
                          ? `Keep ${name(v)}'s record for both`
                          : `Link ${name(v === 'here' ? 'sibling' : 'here')} to ${name(v)}'s record too`}
                    </label>
                  ))}
                  {r.state === 'different' &&
                  ((r.here?.hasLogin ?? false) || (r.sibling?.hasLogin ?? false)) ? (
                    <p className="ep-field__help" style={{ margin: 'var(--sp-2) 0 0' }}>
                      The record not kept stays as it is but no longer has this child: if it has a
                      login, that login stops seeing the child.
                    </p>
                  ) : null}
                </>
              )}
            </fieldset>
          ))}
          <div style={{ display: 'flex', gap: 'var(--sp-3)', marginTop: 'var(--sp-4)' }}>
            <Button type="submit" disabled={todo.length === 0}>
              Link families
            </Button>
            <a className="ep-btn ep-btn--ghost" href={back}>
              Cancel
            </a>
          </div>
          {todo.length === 0 ? (
            <p className="ep-field__help">The two children already share their parent records.</p>
          ) : (
            <p className="ep-field__help">
              Recorded in the log; Undo on the student&apos;s page puts the old records back.
            </p>
          )}
        </form>
      </Card>
    </>
  );
}
