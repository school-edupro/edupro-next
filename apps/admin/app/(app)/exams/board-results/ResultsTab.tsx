import { Badge, Button, Card, DataTable, InputField, SelectField } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { FileLinks } from '@/components/FileLinks';
import { apiFetch } from '@/lib/api';
import { RESULT_WORDS, yearLabel, type BoardMarks } from '@/lib/board-results';

type Row = BoardMarks['rows'][number];

/** The short name of a subject the row also shows in full (the compartment subjects). */
const shortName = (name: string) =>
  name
    .replace(/Language and Literature/i, 'Lng & Lit')
    .replace(/Mathematics/i, 'Maths')
    .replace(/\(Standard\)/i, 'Std')
    .replace(/\(Basic\)/i, 'Basic')
    .replace(/Social Science/i, 'Social Sc');

const SORTS = ['rank', 'roll', 'name', 'section'] as const;
const BANDS = ['90', '75', '60', '45', 'below45'] as const;
const SIZES = ['25', '50', '100', '500'] as const;

/**
 * The Results tab (docs/design/88), as the school's old "Student Marks Data": one row a candidate — every subject with
 * its marks and grade, the compartment subjects, the result, the aggregate by the chosen method, the percentage and
 * the class rank (equal aggregates share a rank) — with the filters, pages, and the list as Excel or PDF.
 */
export async function ResultsTab({
  sp,
}: {
  sp: {
    classLabel?: string;
    examYear?: string;
    section?: string;
    method?: string;
    result?: string;
    band?: string;
    sort?: string;
    q?: string;
    page?: string;
    size?: string;
  };
}) {
  const b = await getTranslations('boardResults');
  const cls = sp.classLabel === 'XII' ? 'XII' : 'X';
  const f = new URLSearchParams({ classLabel: cls });
  if (/^\d{4}$/.test(sp.examYear ?? '')) f.set('examYear', sp.examYear!);
  const section = (sp.section ?? '').trim();
  if (section && section.length <= 40) f.set('section', section);
  if (sp.method === 'all' || sp.method === 'first5') f.set('method', sp.method);
  if (/^[A-Z]{1,8}$/.test(sp.result ?? '')) f.set('result', sp.result!);
  if ((BANDS as readonly string[]).includes(sp.band ?? '')) f.set('band', sp.band!);
  if ((SORTS as readonly string[]).includes(sp.sort ?? '')) f.set('sort', sp.sort!);
  const q = (sp.q ?? '').trim().slice(0, 60);
  if (q) f.set('q', q);
  const size = (SIZES as readonly string[]).includes(sp.size ?? '') ? sp.size! : '100';
  const page = /^\d{1,5}$/.test(sp.page ?? '') ? Math.max(1, Number(sp.page)) : 1;
  const query = new URLSearchParams(f);
  query.set('size', size);
  query.set('page', String(page));
  const d = await apiFetch<BoardMarks>(`/exams/board-results/marks?${query.toString()}`);
  const pages = Math.max(1, Math.ceil(d.total / d.size));
  const pageLink = (p: number) => {
    const x = new URLSearchParams(query);
    x.set('tab', 'results');
    x.set('page', String(p));
    return `/exams/board-results?${x.toString()}`;
  };
  const fileQ = new URLSearchParams(f);
  if (d.examYear) fileQ.set('examYear', String(d.examYear));
  const n = Math.max(d.maxSubjects, 1);
  const pct = (v: number | null) => (v === null ? '—' : `${v.toFixed(2)}%`);

  const subjectCols = Array.from({ length: n }, (_, k) => ({
    key: `s${String(k)}`,
    header: `Subject\u2011${String(k + 1)}`,
    render: (r: Row) => {
      const s = r.subjects[k];
      if (!s) return '–';
      return (
        <span style={{ display: 'grid', justifyItems: 'center', textAlign: 'center' }}>
          <span className="ep-field__help" style={{ margin: 0 }}>
            {s.short === s.name ? s.name : <abbr title={s.name}>{s.short}</abbr>}
          </span>
          {s.counted ? (
            <strong>{s.marks === null ? 'AB' : String(s.marks)}</strong>
          ) : (
            <span className="ep-field__help" style={{ margin: 0 }} title={b('rs_notCounted')}>
              {s.marks === null ? 'AB' : String(s.marks)}
              <span className="ep-sr-only"> ({b('rs_notCounted')})</span>
            </span>
          )}
          <span className="ep-field__help" style={{ margin: 0 }}>
            {s.grade ?? ''}
          </span>
        </span>
      );
    },
  }));

  return (
    <div style={{ display: 'grid', gap: 'var(--sp-4)', gridTemplateColumns: 'minmax(0, 1fr)' }}>
      <Card title={b('rs_title')}>
        <form
          method="get"
          action="/exams/board-results"
          style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap', alignItems: 'flex-end' }}
        >
          <input type="hidden" name="tab" value="results" />
          <SelectField
            id="rs-class"
            name="classLabel"
            label={b('an_class')}
            defaultValue={cls}
            options={[
              { value: 'X', label: 'Class X' },
              { value: 'XII', label: 'Class XII' },
            ]}
          />
          <SelectField
            id="rs-year"
            name="examYear"
            label={b('an_year')}
            defaultValue={d.examYear ? String(d.examYear) : ''}
            options={
              d.years.length
                ? d.years.map((y) => ({
                    value: String(y),
                    label: `${String(y)} (${yearLabel(y)})`,
                  }))
                : [{ value: '', label: '—' }]
            }
          />
          <SelectField
            id="rs-section"
            name="section"
            label={b('an_section')}
            defaultValue={section}
            options={[
              { value: '', label: b('an_allSections') },
              ...d.sections.map((s) => ({ value: s, label: s })),
            ]}
          />
          <SelectField
            id="rs-method"
            name="method"
            label={b('rs_method')}
            defaultValue={d.method}
            options={[
              { value: 'best5', label: b('rs_best5') },
              { value: 'first5', label: b('rs_first5') },
              { value: 'all', label: b('rs_all') },
            ]}
          />
          <SelectField
            id="rs-result"
            name="result"
            label={b('result')}
            defaultValue={sp.result ?? ''}
            options={[
              { value: '', label: b('rs_allResults') },
              ...d.results
                .filter((x) => /^[A-Z]{1,8}$/.test(x.word))
                .map((x) => ({
                  value: x.word,
                  label: `${x.word}${RESULT_WORDS[x.word] ? ` – ${RESULT_WORDS[x.word]!}` : ''} (${String(x.n)})`,
                })),
            ]}
          />
          <SelectField
            id="rs-band"
            name="band"
            label={b('rs_percentage')}
            defaultValue={sp.band ?? ''}
            options={[
              { value: '', label: b('rs_allPercentages') },
              ...BANDS.map((x) => ({ value: x, label: b(`rs_band_${x}`) })),
            ]}
          />
          <SelectField
            id="rs-sort"
            name="sort"
            label={b('rs_sort')}
            defaultValue={sp.sort ?? 'rank'}
            options={SORTS.map((x) => ({ value: x, label: b(`rs_sort_${x}`) }))}
          />
          <InputField id="rs-q" name="q" label={b('search')} defaultValue={q} maxLength={60} />
          <SelectField
            id="rs-size"
            name="size"
            label={b('rs_rows')}
            defaultValue={size}
            options={SIZES.map((x) => ({ value: x, label: x }))}
          />
          <Button type="submit" size="sm">
            {b('an_show')}
          </Button>
        </form>
      </Card>

      {!d.examYear ? (
        <Card title={b('an_noneTitle')}>
          <p style={{ margin: 0 }}>
            {b('an_none', { cls })}{' '}
            <a href="/exams/board-results?tab=upload" style={{ textDecoration: 'underline' }}>
              {b('tab_upload')}
            </a>
          </p>
        </Card>
      ) : (
        <Card
          title={b('rs_list', { n: d.total })}
          actions={
            <span
              style={{
                display: 'inline-flex',
                gap: 'var(--sp-3)',
                alignItems: 'center',
                flexWrap: 'wrap',
              }}
            >
              <span className="ep-field__help">PDF</span>
              <FileLinks
                href={`/exams/board-results/marks/pdf?${fileQ.toString()}`}
                label={b('rs_title')}
              />
              <a
                className="ep-btn ep-btn--secondary ep-btn--sm"
                href={`/exams/board-results/marks/xlsx?${fileQ.toString()}`}
              >
                {b('rs_excel')}
              </a>
            </span>
          }
        >
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            <Badge tone="info">{`Class ${cls}${section ? `-${section}` : ''}`}</Badge>{' '}
            <Badge tone="success">{`${String(d.examYear)} (${yearLabel(d.examYear)})`}</Badge>{' '}
            {d.method === 'best5'
              ? b('rs_ruleBest5', { rule: d.rule })
              : d.method === 'first5'
                ? b('rs_ruleFirst5')
                : b('rs_ruleAll')}{' '}
            {b('rs_legend')}
          </p>
          <div className="ep-table-tight ep-table-freeze-3">
            <DataTable<Row>
              caption={b('rs_title')}
              density="dense"
              columns={[
                { key: 'sr', header: 'Sr#', numeric: true, render: (r) => String(r.sr) },
                { key: 'roll', header: b('rollNo'), render: (r) => r.roll },
                {
                  // the name, with gender and class-section under it (the files keep them as columns)
                  key: 'name',
                  header: b('rs_name'),
                  render: (r) => (
                    <>
                      {r.studentId ? (
                        <a href={`/people/students/${r.studentId}`}>{r.name ?? r.roll}</a>
                      ) : (
                        (r.name ?? '—')
                      )}
                      <span className="ep-field__help" style={{ display: 'block', margin: 0 }}>
                        {[r.sex, r.section ? `${cls}-${r.section}` : cls]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </>
                  ),
                },
                ...subjectCols,
                {
                  // the result, with the compartment subjects under it
                  key: 'res',
                  header: b('result'),
                  render: (r) => (
                    <>
                      <Badge
                        tone={
                          r.result === 'PASS'
                            ? 'success'
                            : r.result === 'COMP'
                              ? 'warning'
                              : 'neutral'
                        }
                      >
                        {r.result ?? '—'}
                      </Badge>
                      {r.compartment.length ? (
                        <span className="ep-field__help" style={{ display: 'block', margin: 0 }}>
                          {`${b('rs_comp')}: ${r.compartment.map((x) => shortName(x.name)).join(', ')}`}
                        </span>
                      ) : null}
                    </>
                  ),
                },
                {
                  // the aggregate over the maximum ("471.00 / 500")
                  key: 'agg',
                  header: b('rs_aggregate'),
                  numeric: true,
                  render: (r) =>
                    r.total === null ? (
                      '—'
                    ) : (
                      <>
                        <strong>{r.total.toFixed(2)}</strong>
                        <span className="ep-field__help" style={{ display: 'block', margin: 0 }}>
                          {`/ ${String(r.max)}`}
                        </span>
                      </>
                    ),
                },
                {
                  key: 'pct',
                  header: b('rs_percent'),
                  numeric: true,
                  render: (r) => <strong>{pct(r.percent)}</strong>,
                },
                {
                  key: 'rank',
                  header: b('rs_rank'),
                  numeric: true,
                  render: (r) => (r.rank === null ? '—' : <strong>{String(r.rank)}</strong>),
                },
              ]}
              rows={d.rows}
              rowKey={(r) => r.roll}
              emptyTitle={b('rs_none')}
            />
          </div>
          {pages > 1 ? (
            <nav
              aria-label={b('rs_pages')}
              style={{
                display: 'flex',
                gap: 'var(--sp-3)',
                alignItems: 'center',
                justifyContent: 'flex-end',
                marginTop: 'var(--sp-3)',
                flexWrap: 'wrap',
              }}
            >
              {page > 1 ? (
                <a className="ep-btn ep-btn--ghost ep-btn--sm" href={pageLink(page - 1)}>
                  {b('rs_prev')}
                </a>
              ) : null}
              <span className="ep-field__help">{b('rs_pageOf', { page, pages })}</span>
              {page < pages ? (
                <a className="ep-btn ep-btn--ghost ep-btn--sm" href={pageLink(page + 1)}>
                  {b('rs_next')}
                </a>
              ) : null}
            </nav>
          ) : null}
        </Card>
      )}
    </div>
  );
}
