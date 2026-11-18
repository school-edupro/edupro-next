import { Button, Card, SelectField } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { BarChart, LineChart, PercentBarChart, type ChartTone } from '@/components/charts/Charts';
import { FileLinks } from '@/components/FileLinks';
import { apiFetch } from '@/lib/api';
import { RESULT_WORDS, yearLabel, type BoardResultAnalysis } from '@/lib/board-results';
import { GroupedTable } from './GroupedTable';

const YEAR_TONES: ChartTone[] = ['muted', 'info', 'cyan', 'warning', 'navy'];
/** 34.29 → "34.3%" */
const pct = (v: number) => {
  const r = Math.round(v * 10) / 10;
  return `${Number.isInteger(r) ? String(r) : r.toFixed(1)}%`;
};
/** a round top for a % scale: 10, 20, 30 … 100 */
const pctTop = (values: number[]) =>
  Math.min(100, Math.max(10, Math.ceil(Math.max(0, ...values) / 10) * 10));

/** A chart's numbers as a small table (a chart's text alternative, folded under it). */
function Numbers({
  caption,
  head,
  rows,
}: {
  caption: string;
  head: string[];
  rows: Array<Array<string | number | null>>;
}) {
  return (
    <details style={{ marginTop: 'var(--sp-2)' }}>
      <summary className="ep-field__help">{caption}</summary>
      <div className="ep-table-wrap" tabIndex={0} role="region" aria-label={caption}>
        <table className="ep-table" data-density="dense">
          <thead>
            <tr>
              {head.map((h, i) => (
                <th key={String(i)} scope="col" style={i ? { textAlign: 'right' } : undefined}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={String(i)}>
                {r.map((v, k) => (
                  <td
                    key={String(k)}
                    style={k ? { textAlign: 'right', whiteSpace: 'nowrap' } : undefined}
                  >
                    {v === null ? '—' : String(v)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/**
 * Result Analysis (docs/design/88), the school's old page of that name: the subject table — students, appeared,
 * absent, pass, fail, compartment, highest, lowest, average, distinction and divisions, grades — and the charts
 * (pass % over the years, each subject's grades A1 … E1 as 100% bars, the marks, every subject's grades across
 * the years as shares), with the same filters on both views and a PDF of each. The old page's faults are put right: the grades add up, their ranges show only when they
 * are counted from the marks, the subject columns stay in view, the divisions have a legend.
 */
export async function ResultAnalysisReport({
  sp,
}: {
  sp: {
    classLabel?: string;
    examYear?: string;
    compare?: string;
    gender?: string;
    code?: string;
    result?: string;
    view?: string;
  };
}) {
  const b = await getTranslations('boardResults');
  const view = sp.view === 'graphs' ? 'graphs' : 'table';
  const cls = sp.classLabel === 'XII' ? 'XII' : 'X';
  const f = new URLSearchParams({ classLabel: cls });
  if (/^\d{4}$/.test(sp.examYear ?? '')) f.set('examYear', sp.examYear!);
  f.set('compare', /^[0-4]$/.test(sp.compare ?? '') ? sp.compare! : '4');
  if (sp.gender === 'M' || sp.gender === 'F' || sp.gender === 'both') f.set('gender', sp.gender);
  if (/^\d{3}$/.test(sp.code ?? '')) f.set('code', sp.code!);
  if (/^[A-Z]{1,8}$/.test(sp.result ?? '')) f.set('result', sp.result!);
  const d = await apiFetch<BoardResultAnalysis>(
    `/exams/board-results/reports/result-analysis?${f.toString()}`,
  );
  const fileQ = new URLSearchParams(f);
  if (d.examYear) fileQ.set('examYear', String(d.examYear));
  const viewLink = (v: 'table' | 'graphs') => {
    const x = new URLSearchParams(fileQ);
    x.set('tab', 'reports');
    x.set('report', 'analysis');
    x.set('view', v);
    return `/exams/board-results?${x.toString()}`;
  };
  const genderWords =
    d.gender === 'both'
      ? b('rp_bothGenders')
      : d.gender === 'M'
        ? b('rp_boys')
        : d.gender === 'F'
          ? b('rp_girls')
          : b('rp_genderAll');
  const ch = d.charts;
  const graphsQ = (() => {
    const x = new URLSearchParams(fileQ);
    x.set('view', 'graphs');
    return x.toString();
  })();

  return (
    <>
      <Card title={b('rp_analysis')}>
        <p className="ep-field__help" style={{ marginTop: 0 }}>
          {b('rp_analysisHelp')}
        </p>
        <form
          method="get"
          action="/exams/board-results"
          style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap', alignItems: 'flex-end' }}
        >
          <input type="hidden" name="tab" value="reports" />
          <input type="hidden" name="report" value="analysis" />
          <input type="hidden" name="view" value={view} />
          <SelectField
            id="ra-class"
            name="classLabel"
            label={b('an_class')}
            defaultValue={cls}
            options={[
              { value: 'X', label: 'Class X' },
              { value: 'XII', label: 'Class XII' },
            ]}
          />
          <SelectField
            id="ra-year"
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
            id="ra-compare"
            name="compare"
            label={b('rp_compareCharts')}
            defaultValue={String(d.compare)}
            options={[0, 1, 2, 3, 4].map((n) => ({
              value: String(n),
              label: b('rp_compareN', { n }),
            }))}
          />
          <SelectField
            id="ra-gender"
            name="gender"
            label={b('rp_gender')}
            defaultValue={d.gender === 'all' ? '' : d.gender}
            options={[
              { value: '', label: b('rp_genderAll') },
              { value: 'M', label: b('rp_boys') },
              { value: 'F', label: b('rp_girls') },
              { value: 'both', label: b('rp_bothGenders') },
            ]}
          />
          <SelectField
            id="ra-code"
            name="code"
            label={b('rp_subject')}
            defaultValue={d.code ?? ''}
            options={[
              { value: '', label: b('rp_allSubjects') },
              ...d.subjects.map((s) => ({ value: s.code, label: `${s.code} - ${s.name}` })),
            ]}
          />
          <SelectField
            id="ra-result"
            name="result"
            label={b('result')}
            defaultValue={d.result ?? ''}
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
          <Button type="submit" size="sm">
            {b('an_show')}
          </Button>
        </form>
      </Card>

      <nav className="ep-tabs-links" aria-label={b('rp_views')}>
        <a href={viewLink('table')} aria-current={view === 'table' ? 'page' : undefined}>
          {b('rp_viewTable')}
        </a>
        <a href={viewLink('graphs')} aria-current={view === 'graphs' ? 'page' : undefined}>
          {b('rp_viewGraphs')}
        </a>
      </nav>

      {!d.table || !ch || !d.examYear ? (
        <Card title={b('an_noneTitle')}>
          <p style={{ margin: 0 }}>
            {b('an_none', { cls })}{' '}
            <a href="/exams/board-results?tab=upload" style={{ textDecoration: 'underline' }}>
              {b('tab_upload')}
            </a>
          </p>
        </Card>
      ) : view === 'table' ? (
        <Card
          title={b('rp_analysisTitle')}
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
                href={`/exams/board-results/reports/analysis/pdf?${fileQ.toString()}`}
                label={b('rp_analysis')}
              />
              <a
                className="ep-btn ep-btn--secondary ep-btn--sm"
                href={`/exams/board-results/reports/analysis/xlsx?${fileQ.toString()}`}
              >
                {b('rs_excel')}
              </a>
            </span>
          }
        >
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            {`Class ${cls} · ${String(d.examYear)} (${yearLabel(d.examYear)}) · ${genderWords}${
              d.result ? ` · ${d.result}` : ''
            }`}
          </p>
          <GroupedTable t={d.table} label={b('rp_analysis')} freeze={3} />
          {d.table.note ? (
            <p className="ep-field__help" style={{ marginBottom: 0 }}>
              {d.table.note}
            </p>
          ) : null}
        </Card>
      ) : (
        <div style={{ display: 'grid', gap: 'var(--sp-4)', gridTemplateColumns: 'minmax(0, 1fr)' }}>
          <Card
            title={b('rp_graphsTitle')}
            actions={
              <span style={{ display: 'inline-flex', gap: 'var(--sp-3)', alignItems: 'center' }}>
                <span className="ep-field__help">PDF</span>
                <FileLinks
                  href={`/exams/board-results/reports/analysis/pdf?${graphsQ}`}
                  label={b('rp_graphsTitle')}
                />
              </span>
            }
          >
            <p className="ep-field__help" style={{ margin: 0 }}>
              {`Class ${cls} · ${String(d.examYear)} (${yearLabel(d.examYear)}) · ${genderWords}${
                d.result ? ` · ${d.result}` : ''
              }${d.code ? ` · ${d.code}` : ''}. ${b('rp_chartsNote')}`}
            </p>
          </Card>
          <Card title={b('rp_chartPass')}>
            <p className="ep-field__help" style={{ marginTop: 0 }}>
              {d.code ? b('rp_chartPassSubject', { code: d.code }) : b('rp_chartPassHelp')}
            </p>
            <LineChart
              title={b('rp_chartPass')}
              labels={ch.passTrend.labels}
              series={ch.passTrend.series.map((s, i) => ({
                label: s.label,
                tone: (['navy', 'cyan', 'success'] as ChartTone[])[i] ?? 'navy',
                values: s.values,
              }))}
              max={100}
              suffix="%"
            />
            <Numbers
              caption={b('rp_numbers')}
              head={[b('an_year'), ...ch.passTrend.series.map((s) => `${s.label} %`)]}
              rows={ch.passTrend.labels.map((l, i) => [
                l,
                ...ch.passTrend.series.map((s) => s.values[i] ?? null),
              ])}
            />
          </Card>
          <Card title={b('rp_chartGrades')}>
            <p className="ep-field__help" style={{ marginTop: 0 }}>
              {b('rp_chartGradesHelp')}
            </p>
            <PercentBarChart
              title={b('rp_chartGrades')}
              data={ch.gradeSpread.map((s) => ({
                label: s.code,
                values: s.counts,
                of: s.appeared,
              }))}
              series={ch.grades.map((label, i) => ({ label, tone: ch.tones[i] ?? 'muted' }))}
            />
            <Numbers
              caption={b('rp_numbersPct')}
              head={[b('rp_subject'), b('an_appeared'), ...ch.grades]}
              rows={ch.gradeSpread.map((s) => [
                `${s.code} ${s.name}`,
                s.appeared,
                ...s.counts.map((n, i) => `${String(n)} (${pct(s.pct[i] ?? 0)})`),
              ])}
            />
          </Card>
          <Card title={b('rp_chartMarks')}>
            <p className="ep-field__help" style={{ marginTop: 0 }}>
              {b('rp_chartMarksHelp')}
            </p>
            <BarChart
              title={b('rp_chartMarks')}
              data={ch.marks.map((s) => ({ label: s.code, values: s.values }))}
              series={[
                { label: b('rs_highest'), tone: 'navy' },
                { label: b('rs_average'), tone: 'cyan' },
                { label: b('rs_lowest'), tone: 'warning' },
              ]}
            />
            <Numbers
              caption={b('rp_numbers')}
              head={[b('rp_subject'), b('rs_highest'), b('rs_average'), b('rs_lowest')]}
              rows={ch.marks.map((s) => [`${s.code} ${s.name}`, ...s.values])}
            />
          </Card>
          {ch.subjectYears.length ? (
            <Card title={b('rp_chartYears')}>
              <p className="ep-field__help" style={{ marginTop: 0 }}>
                {b('rp_chartYearsHelp')}
              </p>
              <div
                style={{
                  display: 'grid',
                  gap: 'var(--sp-5)',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 400px), 1fr))',
                }}
              >
                {ch.subjectYears.map((s) => {
                  const title = b('rp_chartSubjectYears', { subject: `${s.code} ${s.name}` });
                  return (
                    <section key={s.code} aria-labelledby={`ra-years-${s.code}`}>
                      <h3
                        id={`ra-years-${s.code}`}
                        className="ep-field__label"
                        style={{ margin: '0 0 var(--sp-2)' }}
                      >
                        {title}
                      </h3>
                      <BarChart
                        title={title}
                        width={400}
                        data={ch.grades.map((g, i) => ({
                          label: g,
                          values: s.series.map((y) => y.pct[i] ?? 0),
                        }))}
                        series={s.series.map((y, i) => ({
                          label: `${y.label} (${String(y.appeared)})`,
                          tone: YEAR_TONES[
                            (YEAR_TONES.length - s.series.length + i) % YEAR_TONES.length
                          ]!,
                        }))}
                        max={pctTop(s.series.flatMap((y) => y.pct))}
                        suffix="%"
                      />
                      <Numbers
                        caption={b('rp_numbersPct')}
                        head={[b('an_year'), b('an_appeared'), ...ch.grades]}
                        rows={s.series.map((y) => [
                          y.label,
                          y.appeared,
                          ...y.counts.map((n, i) => `${String(n)} (${pct(y.pct[i] ?? 0)})`),
                        ])}
                      />
                    </section>
                  );
                })}
              </div>
            </Card>
          ) : null}
        </div>
      )}
    </>
  );
}
