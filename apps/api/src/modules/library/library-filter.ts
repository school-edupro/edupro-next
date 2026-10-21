import { DomainError } from '../../common/errors/domain-error';
import type { BookFilter } from './library-books.dto';

/** An accession number split into its prefix and its number (B00125 → B, 125). */
const split = (s: string) => {
  const m = /^(.*?)(\d+)$/.exec(s);
  return m ? { prefix: m[1]!, n: m[2]! } : { prefix: s, n: null };
};

/**
 * The book list's filters as SQL (docs/design/36-library.md, part 3), for every view of it: the
 * conditions on the title (alias `t`) and on its copies (alias `x`), the values bound in order. The
 * list of titles keeps a title with a copy that matches; the register of copies keeps the copies; the
 * Excel export does either.
 */
export function bookFilter(q: BookFilter, start: unknown[] = []) {
  const args = [...start];
  const arg = (v: unknown) => {
    args.push(v);
    return `$${String(args.length)}`;
  };
  const title: string[] = [`t.status = 'active'`];
  const copy: string[] = [];
  if (q.q) {
    const p = arg(`%${q.q}%`);
    const digits = arg(q.q.replace(/[\s-]/g, '').toUpperCase());
    // eslint-disable-next-line no-restricted-syntax -- placeholders and fixed words only; values are bound
    title.push(`(t.title ILIKE ${p} OR t.subtitle ILIKE ${p} OR t.author ILIKE ${p} OR t.code ILIKE ${p}
                 OR t.call_no ILIKE ${p} OR array_to_string(t.keywords, ' ') ILIKE ${p}
                 OR regexp_replace(COALESCE(t.isbn, ''), '[^0-9X]', '', 'g') = ${digits}
                 OR EXISTS (SELECT 1 FROM library_copies a WHERE a.title_id = t.id
                             AND (a.accession_no ILIKE ${p} OR a.barcode = ${digits}
                                  OR EXISTS (SELECT 1 FROM library_accession_changes h
                                              WHERE h.copy_id = a.id AND h.old_no ILIKE ${p}))))`);
  }
  if (q.materialTypeId) title.push(`t.material_type_id = ${arg(q.materialTypeId)}`);
  if (q.subjectId) title.push(`t.subject_id = ${arg(q.subjectId)}`);
  if (q.languageId) title.push(`t.language_id = ${arg(q.languageId)}`);
  if (q.classId) title.push(`t.class_id = ${arg(q.classId)}`);
  if (q.author) {
    const p = arg(`%${q.author}%`);
    // eslint-disable-next-line no-restricted-syntax -- placeholders and fixed words only; values are bound
    title.push(`EXISTS (SELECT 1 FROM library_title_authors ta JOIN library_authors a ON a.id = ta.author_id
                         WHERE ta.title_id = t.id AND a.name ILIKE ${p})`);
  }
  if (q.publisher) title.push(`t.publisher ILIKE ${arg(`%${q.publisher}%`)}`);
  if (q.yearFrom) title.push(`t.year >= ${arg(q.yearFrom)}`);
  if (q.yearTo) title.push(`t.year <= ${arg(q.yearTo)}`);
  if (q.libraryId) copy.push(`x.library_id = ${arg(q.libraryId)}`);
  if (q.shelfId) copy.push(`x.shelf_id = ${arg(q.shelfId)}`);
  if (q.rack) copy.push(`x.rack = ${arg(q.rack)}`);
  if (q.status) copy.push(`x.status = ${arg(q.status)}::library_copy_status`);
  if (q.acquisition) copy.push(`x.acquisition = ${arg(q.acquisition)}`);
  if (q.vendorId) copy.push(`x.vendor_id = ${arg(q.vendorId)}`);
  if (q.accessionedFrom) copy.push(`x.accessioned_on >= ${arg(q.accessionedFrom)}::date`);
  if (q.accessionedTo) copy.push(`x.accessioned_on <= ${arg(q.accessionedTo)}::date`);
  if (q.stock === 'never') copy.push(`x.last_verified_on IS NULL`);
  if (q.stock === 'checked')
    copy.push(
      q.checkedSince
        ? `x.last_verified_on >= ${arg(q.checkedSince)}::date`
        : `x.last_verified_on IS NOT NULL`,
    );
  if (q.accessionFrom || q.accessionTo) {
    const a = q.accessionFrom ? split(q.accessionFrom) : null;
    const b = q.accessionTo ? split(q.accessionTo) : null;
    if (a && b && a.prefix !== b.prefix)
      throw new DomainError('validation-failed', 'Accession numbers from and to: the same prefix', {
        status: 400,
      });
    const prefix = (a ?? b)!.prefix;
    if ((a && a.n === null) || (b && b.n === null)) {
      // no number at the end: compared as written
      if (a) copy.push(`x.accession_no >= ${arg(q.accessionFrom)}`);
      if (b) copy.push(`x.accession_no <= ${arg(q.accessionTo)}`);
    } else {
      copy.push(`regexp_replace(x.accession_no, '[0-9]+$', '') = ${arg(prefix)}`);
      const num = `NULLIF(substring(x.accession_no FROM '[0-9]+$'), '')::numeric`;
      if (a) copy.push(`${num} >= ${arg(a.n)}::numeric`);
      if (b) copy.push(`${num} <= ${arg(b.n)}::numeric`);
    }
  }
  return { title: title.join(' AND '), copy: copy.length ? copy.join(' AND ') : null, args, arg };
}

/** How a list is sorted; at the level of titles a copy's sort falls back to the title. */
export function bookSort(q: Pick<BookFilter, 'sort' | 'dir'>, level: 'copy' | 'title') {
  const dir = q.dir === 'desc' ? 'DESC' : 'ASC';
  // eslint-disable-next-line no-restricted-syntax -- placeholders and fixed words only; values are bound
  const natural = `regexp_replace(x.accession_no, '[0-9]+$', '') ${dir}, NULLIF(substring(x.accession_no FROM '[0-9]+$'), '')::numeric ${dir} NULLS LAST, x.accession_no ${dir}`;
  const by: Record<BookFilter['sort'], string> = {
    title: `lower(t.title) ${dir}`,
    author: `lower(t.author) ${dir} NULLS LAST`,
    callNo: `t.call_no ${dir} NULLS LAST`,
    year: `t.year ${dir} NULLS LAST`,
    publisher: `lower(t.publisher) ${dir} NULLS LAST`,
    accession: level === 'copy' ? natural : `lower(t.title) ${dir}`,
    price:
      level === 'copy'
        ? `COALESCE(x.price, t.price) ${dir} NULLS LAST`
        : `t.price ${dir} NULLS LAST`,
    accessioned: level === 'copy' ? `x.accessioned_on ${dir}` : `t.created_at ${dir}`,
    status: level === 'copy' ? `x.status ${dir}` : `lower(t.title) ${dir}`,
    library: level === 'copy' ? `l.name ${dir}` : `lower(t.title) ${dir}`,
  };
  return `${by[q.sort]}, ${level === 'copy' ? 'x.id' : 't.id'}`;
}
