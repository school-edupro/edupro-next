import { Button, Card, SelectField } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { FileLinks } from '@/components/FileLinks';
import { apiFetch } from '@/lib/api';
import { yearLabel, type BoardRange } from '@/lib/board-results';

/** The ready-made reports of the Reports tab (more join the list as they are built). */
const REPORTS = ['range'] as const;

/**
 * The Reports tab (docs/design/88): reports EduPro makes ready from the saved CBSE results, as the school's old
 * system had them. First, the Range Wise Subject Summary — each subject's students, appeared, absent, pass, fail,
 * compartment, distinction, divisions, grades and marks, a count and a share for the year and the years compared.
 */
export async function ReportsTab({
  sp,
}: {
  sp: {
    classLabel?: string;
    examYear?: string;
    compare?: string;
    gender?: string;
    code?: string;
    report?: string;
  };
}) {
  const b = await getTranslations('boardResults');
  const report = 'range';
  const cls = sp.classLabel === 'XII' ? 'XII' : 'X';
  const f = new URLSearchParams({ classLabel: cls });
  if (/^\d{4}$/.test(sp.examYear ?? '')) f.set('examYear', sp.examYear!);
  f.set('compare', /^[0-4]$/.test(sp.compare ?? '') ? sp.compare! : '1');
  if (sp.gender === 'M' || sp.gender === 'F') f.set('gender', sp.gender);
  if (/^\d{3}$/.test(sp.code ?? '')) f.set('code', sp.code!);
  const d = await apiFetch<BoardRange>(
    `/exams/board-results/reports/range-subjects?${f.toString()}`,
  );
  const fileQ = new URLSearchParams(f);
  if (d.examYear) fileQ.set('examYear', String(d.examYear));
  const years = d.summary?.years ?? [];
  const cell = (v: { count: number | null; pct: number | null } | undefined) => ({
    count: v?.count === null || v?.count === undefined ? '' : String(v.count),
    pct: v?.pct === null || v?.pct === undefined ? '' : `${v.pct.toFixed(2)}%`,
  });

  return (
    <div style={{ display: 'grid', gap: 'var(--sp-4)', gridTemplateColumns: 'minmax(0, 1fr)' }}>
      <nav className="ep-tabs-links" aria-label={b('rp_list')}>
        {REPORTS.map((x) => (
          <a
            key={x}
            href={`/exams/board-results?tab=reports&report=${x}`}
            aria-current={x === report ? 'page' : undefined}
          >
            {b(`rp_${x}`)}
          </a>
        ))}
      </nav>
      <Card title={b('rp_range')}>
        <p className="ep-field__help" style={{ marginTop: 0 }}>
          {b('rp_rangeHelp')}
        </p>
        <form
          method="get"
          action="/exams/board-results"
          style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap', alignItems: 'flex-end' }}
        >
          <input type="hidden" name="tab" value="reports" />
          <input type="hidden" name="report" value={report} />
          <SelectField
            id="rp-class"
            name="classLabel"
            label={b('an_class')}
            defaultValue={cls}
            options={[
              { value: 'X', label: 'Class X' },
              { value: 'XII', label: 'Class XII' },
            ]}
          />
          <SelectField
            id="rp-year"
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
            id="rp-compare"
            name="compare"
            label={b('rp_compare')}
            defaultValue={String(d.compare)}
            options={[0, 1, 2, 3, 4].map((n) => ({
              value: String(n),
              label: b('rp_compareN', { n }),
            }))}
          />
          <SelectField
            id="rp-gender"
            name="gender"
            label={b('rp_gender')}
            defaultValue={d.gender === 'all' ? '' : d.gender}
            options={[
              { value: '', label: b('rp_genderAll') },
              { value: 'M', label: b('rp_boys') },
              { value: 'F', label: b('rp_girls') },
            ]}
          />
          <SelectField
            id="rp-code"
            name="code"
            label={b('rp_subject')}
            defaultValue={d.code ?? ''}
            options={[
              { value: '', label: b('rp_allSubjects') },
              ...d.subjects.map((s) => ({ value: s.code, label: `${s.code} - ${s.name}` })),
            ]}
          />
          <Button type="submit" size="sm">
            {b('an_show')}
          </Button>
        </form>
      </Card>

      {!d.summary ? (
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
          title={b('rp_range')}
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
                href={`/exams/board-results/reports/range/pdf?${fileQ.toString()}`}
                label={b('rp_range')}
              />
              <a
                className="ep-btn ep-btn--secondary ep-btn--sm"
                href={`/exams/board-results/reports/range/xlsx?${fileQ.toString()}`}
              >
                {b('rs_excel')}
              </a>
            </span>
          }
        >
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            {`Class ${cls} · ${years.map((y) => yearLabel(y)).join(` ${b('rp_against')} `)} · ${
              d.gender === 'M' ? b('rp_boys') : d.gender === 'F' ? b('rp_girls') : b('rp_genderAll')
            }`}
            {years.length - 1 < d.compare ? ` · ${b('rp_fewerYears')}` : ''}
          </p>
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label={b('rp_range')}>
            <table className="ep-table" data-density="dense">
              <caption className="ep-sr-only">{b('rp_range')}</caption>
              <thead>
                <tr>
                  <th scope="col" rowSpan={2}>
                    {b('rp_sr')}
                  </th>
                  <th scope="col" rowSpan={2}>
                    {b('rp_codeName')}
                  </th>
                  {years.map((y) => (
                    <th key={y} scope="colgroup" colSpan={2}>
                      {yearLabel(y)}
                    </th>
                  ))}
                </tr>
                <tr>
                  {years.flatMap((y) => [
                    <th key={`${String(y)}c`} scope="col" style={{ textAlign: 'right' }}>
                      {b('rp_count')}
                    </th>,
                    <th key={`${String(y)}p`} scope="col" style={{ textAlign: 'right' }}>
                      %
                    </th>,
                  ])}
                </tr>
              </thead>
              {d.summary.blocks.length ? (
                d.summary.blocks.map((blk) => (
                  <tbody key={blk.code}>
                    <tr>
                      <th
                        scope="rowgroup"
                        colSpan={2 + years.length * 2}
                        style={{ textAlign: 'left' }}
                      >
                        {`${blk.code} - ${blk.name.toUpperCase()}`}
                      </th>
                    </tr>
                    {blk.rows.map((row, i) => (
                      <tr key={row.key}>
                        <td>{String(i + 1)}</td>
                        <td>{row.label}</td>
                        {years.flatMap((y) => {
                          const c = cell(row.values[String(y)]);
                          return [
                            <td key={`${String(y)}c`} style={{ textAlign: 'right' }}>
                              {c.count}
                            </td>,
                            <td key={`${String(y)}p`} style={{ textAlign: 'right' }}>
                              {c.pct}
                            </td>,
                          ];
                        })}
                      </tr>
                    ))}
                  </tbody>
                ))
              ) : (
                <tbody>
                  <tr>
                    <td colSpan={2 + years.length * 2}>{b('rp_none')}</td>
                  </tr>
                </tbody>
              )}
            </table>
          </div>
          <p className="ep-field__help" style={{ marginBottom: 0 }}>
            {d.grades === 'marks' ? b('rp_noteMarks') : b('rp_notePrinted')}
          </p>
        </Card>
      )}
    </div>
  );
}
