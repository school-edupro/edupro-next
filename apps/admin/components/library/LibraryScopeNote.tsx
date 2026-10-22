import { apiFetch } from '@/lib/api';

/**
 * For someone who works in some libraries only (docs/design/36-library.md, "Library round 3", part 3):
 * which, so a book "missing" from a list is not taken for lost. Nothing for someone who works in all.
 */
export async function LibraryScopeNote() {
  const me = await apiFetch<{ mine: Array<{ id: string; name: string }> | null }>(
    '/library/staff/me',
  ).catch(() => ({ mine: null }));
  if (!me.mine?.length) return null;
  return (
    <p className="ep-alert ep-alert--info" role="status" style={{ marginBottom: 'var(--sp-4)' }}>
      You work in {me.mine.map((l) => l.name).join(', ')}: the books, desk, stock and reports here
      are of {me.mine.length === 1 ? 'it' : 'them'} only. A book of another library can still be
      taken back at your desk.
    </p>
  );
}
