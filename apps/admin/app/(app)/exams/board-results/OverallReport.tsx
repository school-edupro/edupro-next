import { Button, Card, SelectField } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { FileLinks } from '@/components/FileLinks';
import { apiFetch } from '@/lib/api';
import { yearLabel, type BoardOverall } from '@/lib/board-results';

/**
 * Range Wise Summary (docs/design/88), the school's old "Result Summary": the class's students, appeared, absent,
 * pass, fail and compartment (by the CBSE result), distinction, divisions and aggregate ranges (by each student's
 * aggregate), the highest, lowest and average aggregate — a count and a share a year, against earlier years.
 */
export async function OverallReport({
  sp,
}: {
  sp: {
    classLabel?: string;
    examYear?: string;
    compare?: string;
    gender?: string;
    method?: string;
  };
}) {
  const b = await getTranslations('boardResults');
  const cls = sp.classLabel === 'XII' ? 'XII' : 'X';
  const f = new URLSearchParams({ classLabel: cls });
  if (/^\d{4}$/.test(sp.examYear ?? '')) f.set('examYear', sp.examYear!);
  f.set('compare', /^[0-4]$/.test(sp.compare ?? '') ? sp.compare! : '0');
  if (sp.gender === 'M' || sp.gender === 'F') f.set('gender', sp.gender);
  if (sp.method === 'all') f.set('method', 'all');
  const d = await apiFetch<BoardOverall>(
    `/exams/board-results/reports/range-overall?${f.toString()}`,
  );
  const fileQ = new URLSearchParams(f);
  if (d.examYear) fileQ.set('examYear', String(d.examYear));
  const years = d.summary?.years ?? [];
  const rows = d.summary?.blocks[0]?.rows ?? [];

  return (
    <>
      <Card title={b('rp_overall')}>
        <p className="ep-field__help" style={{ marginTop: 0 }}>
          {b('rp_overallHelp')}
        </p>
        <form
          method="get"
          action="/exams/board-results"
          style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap', alignItems: 'flex-end' }}
        >
          <input type="hidden" name="tab" value="reports" />
          <input type="hidden" name="report" value="overall" />
          <SelectField
            id="ov-class"
            name="classLabel"
            label={b('an_class')}
            defaultValue={cls}
            options={[
              { value: 'X', label: 'Class X' },
              { value: 'XII', label: 'Class XII' },
            ]}
          />
          <SelectField
            id="ov-year"
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
            id="ov-compare"
            name="compare"
            label={b('rp_compare')}
            defaultValue={String(d.compare)}
            options={[0, 1, 2, 3, 4].map((n) => ({
              value: String(n),
              label: b('rp_compareN', { n }),
            }))}
          />
          <SelectField
            id="ov-method"
            name="method"
            label={b('rs_method')}
            defaultValue={d.method}
            options={[
              { value: 'best5', label: b('rs_best5') },
              { value: 'all', label: b('rs_all') },
            ]}
          />
          <SelectField
            id="ov-gender"
            name="gender"
            label={b('rp_gender')}
            defaultValue={d.gender === 'all' ? '' : d.gender}
            options={[
              { value: '', label: b('rp_genderAll') },
              { value: 'M', label: b('rp_boys') },
              { value: 'F', label: b('rp_girls') },
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
          title={b('rp_overall')}
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
                href={`/exams/board-results/reports/overall/pdf?${fileQ.toString()}`}
                label={b('rp_overall')}
              />
              <a
                className="ep-btn ep-btn--secondary ep-btn--sm"
                href={`/exams/board-results/reports/overall/xlsx?${fileQ.toString()}`}
              >
                {b('rs_excel')}
              </a>
            </span>
          }
        >
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            {`Class ${cls} · ${years.map((y) => yearLabel(y)).join(` ${b('rp_against')} `)} · ${
              d.gender === 'M' ? b('rp_boys') : d.gender === 'F' ? b('rp_girls') : b('rp_genderAll')
            } · ${d.method === 'best5' ? b('rs_ruleBest5', { rule: d.rule }) : b('rs_ruleAll')}`}
            {years.length - 1 < d.compare ? ` · ${b('rp_fewerYears')}` : ''}
          </p>
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label={b('rp_overall')}>
            <table className="ep-table" data-density="dense">
              <caption className="ep-sr-only">{b('rp_overall')}</caption>
              <thead>
                <tr>
                  <th scope="col" rowSpan={years.length > 1 ? 2 : 1}>
                    {b('rp_sr')}
                  </th>
                  <th scope="col" rowSpan={years.length > 1 ? 2 : 1}>
                    {b('rp_range_marks')}
                  </th>
                  {years.length > 1
                    ? years.map((y) => (
                        <th key={y} scope="colgroup" colSpan={2}>
                          {yearLabel(y)}
                        </th>
                      ))
                    : [
                        <th key="n" scope="col" style={{ textAlign: 'right' }}>
                          {b('rp_students')}
                        </th>,
                        <th key="p" scope="col" style={{ textAlign: 'right' }}>
                          {b('rp_percentage')}
                        </th>,
                      ]}
                </tr>
                {years.length > 1 ? (
                  <tr>
                    {years.flatMap((y) => [
                      <th key={`${String(y)}n`} scope="col" style={{ textAlign: 'right' }}>
                        {b('rp_students')}
                      </th>,
                      <th key={`${String(y)}p`} scope="col" style={{ textAlign: 'right' }}>
                        {b('rp_percentage')}
                      </th>,
                    ])}
                  </tr>
                ) : null}
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={row.key}>
                    <td>{String(i + 1)}</td>
                    <td>{row.label}</td>
                    {years.flatMap((y) => {
                      const v = row.values[String(y)];
                      return [
                        <td key={`${String(y)}n`} style={{ textAlign: 'right' }}>
                          {v?.count === null || v?.count === undefined ? '' : String(v.count)}
                        </td>,
                        <td key={`${String(y)}p`} style={{ textAlign: 'right' }}>
                          {v?.pct === null || v?.pct === undefined ? '' : `${v.pct.toFixed(2)}%`}
                        </td>,
                      ];
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="ep-field__help" style={{ marginBottom: 0 }}>
            {b('rp_overallNote')}
          </p>
        </Card>
      )}
    </>
  );
}
