import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import type { LabelsDto } from './library-books.dto';
import { bookFilter, bookSort } from './library-filter';
import { PRESETS, labelsPdf, type Label, type Sheet } from './library-labels';

const PREF = 'library.labels.settings';
const MAX = 3000;
const A4 = { width: 210, height: 297 };

/**
 * Barcode and spine labels (docs/design/36-library.md, part 5): the copies of an accession range, a
 * list typed or scanned, the copies added between two days, or a title's copies; a barcode label, a
 * spine label or both, on a sheet preset or one measured; the first labels of a used sheet skipped. The
 * barcode is the accession number, as the issue desk reads it. Each user's last settings are kept.
 */
@Injectable()
export class LibraryLabelsService {
  constructor(private readonly db: DbService) {}

  async setup(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(
        `SELECT app.library_seed(app.current_school_id()) WHERE app.my_libraries() IS NULL`,
      );
      const libraries = await c.query<{ id: string; code: string; name: string }>(
        `SELECT id::text, code, name FROM library_libraries WHERE status = 'active' ORDER BY code`,
      );
      const last = await c.query<{ value: Record<string, unknown> }>(
        `SELECT value FROM user_preferences WHERE user_id = $1 AND pref_key = $2`,
        [ctx.user.id, PREF],
      );
      return {
        presets: Object.entries(PRESETS).map(([id, p]) => ({ id, ...p })),
        libraries: libraries.rows,
        last: last.rows[0]?.value ?? null,
      };
    });
  }

  /** The sheet asked for, checked to fit on A4. */
  private sheet(q: LabelsDto): Sheet {
    if (q.preset !== 'custom') return PRESETS[q.preset]!;
    const s = q.custom;
    if (!s)
      throw new DomainError('validation-failed', 'A sheet of your own needs its measurements', {
        status: 400,
      });
    if (s.left + s.cols * s.width + (s.cols - 1) * s.gapX > A4.width + 0.01)
      throw new DomainError('validation-failed', 'The labels are wider than an A4 sheet (210 mm)', {
        status: 400,
      });
    if (s.top + s.rows * s.height + (s.rows - 1) * s.gapY > A4.height + 0.01)
      throw new DomainError(
        'validation-failed',
        'The labels are taller than an A4 sheet (297 mm)',
        {
          status: 400,
        },
      );
    return s;
  }

  /** The copies to label, in accession order (a list in the order given), and the numbers not found. */
  private async copies(c: PoolClient, q: LabelsDto) {
    const status = q.includeWithdrawn ? '' : ` AND x.status NOT IN ('withdrawn', 'sold')`;
    const select = `SELECT x.accession_no, t.title, t.call_no, l.name AS library
                      FROM library_copies x JOIN library_titles t ON t.id = x.title_id
                      JOIN library_libraries l ON l.id = x.library_id`;
    type Row = { accession_no: string; title: string; call_no: string | null; library: string };
    if (q.source === 'list') {
      if (!q.list?.length)
        throw new DomainError('validation-failed', 'Type or scan the accession numbers', {
          status: 400,
        });
      const wanted = [...new Set(q.list)];
      const r = await c.query<Row>(
        // eslint-disable-next-line no-restricted-syntax -- fixed fragments; values are bound
        `${select} WHERE x.accession_no = ANY($1::text[])${status}`,
        [wanted],
      );
      const by = new Map(r.rows.map((x) => [x.accession_no, x]));
      return {
        rows: wanted.map((a) => by.get(a)).filter((x): x is Row => Boolean(x)),
        missing: wanted.filter((a) => !by.has(a)),
      };
    }
    if (q.source === 'range' && !q.from && !q.to)
      throw new DomainError('validation-failed', 'Give the first or the last accession number', {
        status: 400,
      });
    if (q.source === 'added' && !q.addedFrom)
      throw new DomainError('validation-failed', 'Give the day the copies were added from', {
        status: 400,
      });
    if (q.source === 'title' && !q.titleId)
      throw new DomainError('validation-failed', 'Which title?', { status: 400 });
    const f = bookFilter({
      ...(q.source === 'range' ? { accessionFrom: q.from, accessionTo: q.to } : {}),
      ...(q.source === 'added' ? { accessionedFrom: q.addedFrom, accessionedTo: q.addedTo } : {}),
      ...(q.libraryId ? { libraryId: q.libraryId } : {}),
      sort: 'accession',
      dir: 'asc',
    });
    const title = q.source === 'title' ? ` AND t.id = ${f.arg(q.titleId)}` : '';
    const r = await c.query<Row>(
      // eslint-disable-next-line no-restricted-syntax -- fixed fragments of bookFilter and bookSort; values are bound
      `${select} WHERE ${f.title}${f.copy ? ` AND ${f.copy}` : ''}${title}${status}
        ORDER BY ${bookSort({ sort: 'accession', dir: 'asc' }, 'copy')} LIMIT ${String(MAX + 1)}`,
      f.args,
    );
    return { rows: r.rows, missing: [] as string[] };
  }

  async print(ctx: RequestContext, q: LabelsDto) {
    const sheet = this.sheet(q);
    if (q.skip >= sheet.cols * sheet.rows)
      throw new DomainError(
        'validation-failed',
        `A sheet has ${String(sheet.cols * sheet.rows)} labels: start at one of them`,
        { status: 400 },
      );
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const { rows, missing } = await this.copies(c, q);
      if (rows.length > MAX)
        throw new DomainError(
          'validation-failed',
          `More than ${String(MAX)} copies: print them in parts`,
          {
            status: 400,
          },
        );
      const per = (q.kind === 'both' ? 2 : 1) * q.copies;
      const count = {
        copies: rows.length,
        labels: rows.length * per,
        sheets: Math.ceil((q.skip + rows.length * per) / (sheet.cols * sheet.rows)) || 0,
        first: rows[0]?.accession_no ?? null,
        last: rows[rows.length - 1]?.accession_no ?? null,
        missing,
      };
      if (q.dry) return count;
      if (!rows.length)
        throw new DomainError('library.no_copies', 'No copy to label', { status: 409 });
      const school =
        q.top === 'school'
          ? (
              await c.query<{ name: string }>(
                `SELECT name FROM schools WHERE id = app.current_school_id()`,
              )
            ).rows[0]!.name
          : null;
      const labels: Label[] = rows.map((x) => ({
        accessionNo: x.accession_no,
        title: q.showTitle ? x.title : null,
        callNo: x.call_no,
        top: q.top === 'library' ? x.library : school,
      }));
      const pdf = await labelsPdf(labels, {
        kind: q.kind,
        sheet,
        copies: q.copies,
        skip: q.skip,
        title: `Library labels ${count.first ?? ''}–${count.last ?? ''}`,
      });
      // the settings come back next time
      await c.query(
        `INSERT INTO user_preferences (school_id, user_id, pref_key, value)
         VALUES (app.current_school_id(), $1, $2, $3::jsonb)
         ON CONFLICT (school_id, user_id, pref_key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [
          ctx.user.id,
          PREF,
          JSON.stringify({
            kind: q.kind,
            preset: q.preset,
            custom: q.custom ?? null,
            copies: q.copies,
            top: q.top,
            showTitle: q.showTitle,
          }),
        ],
      );
      return {
        ...count,
        filename: `Library-labels-${(count.first ?? 'copies').replace(/[^A-Za-z0-9-]/g, '')}.pdf`,
        contentType: 'application/pdf',
        base64: pdf.bytes.toString('base64'),
        pages: pdf.pages,
      };
    });
  }
}
