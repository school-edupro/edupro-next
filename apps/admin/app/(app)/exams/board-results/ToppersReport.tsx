import { Button, Card, Checkbox, InputField, SelectField } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { BarChart, type ChartTone } from '@/components/charts/Charts';
import { FileLinks } from '@/components/FileLinks';
import { apiFetch } from '@/lib/api';
import {
  yearLabel,
  type BoardTopperList,
  type BoardToppers,
  type BoardToppersBlock,
} from '@/lib/board-results';

const LIST_TONES: Record<BoardTopperList['kind'], ChartTone> = {
  top: 'navy',
  low: 'warning',
  pct: 'cyan',
};

/** 93.6 → "93.60" for the aggregate; a subject's whole marks as they are */
const pctText = (v: number, aggregate: boolean) =>
  aggregate ? v.toFixed(2) : Number.isInteger(v) ? String(v) : v.toFixed(1);

/** A bar on a fixed 0–100 scale, so the lengths compare fairly (the old report's scale ran from the lowest bar). */
function Bar({ value, tone }: { value: number; tone: ChartTone }) {
  return (
    <svg
      viewBox="0 0 100 8"
      preserveAspectRatio="none"
      aria-hidden="true"
      style={{ width: '100%', minWidth: '4rem', height: '0.6rem', display: 'block' }}
    >
      <rect className="ep-chart__track" x="0" y="0" width="100" height="8" rx="2" />
      <rect
        className={`ep-chart-fill--${tone}`}
        x="0"
        y="0"
        width={Math.max(0, Math.min(100, value))}
        height="8"
        rx="2"
      />
    </svg>
  );
}

/**
 * Topper Report (docs/design/88), the school's old report of that name: the class's toppers by the aggregate (best
 * five, first five or all subjects) and each subject's toppers by its marks, with the lowest scorers and a
 * percentage list when asked, for a section and gender, and the toppers over the years compared. Ranks are dense, so
 * "top 5" is the top five ranks — each list says how many students that is. The old report's faults are put right:
 * the class is "Class" (sections are sections), one subject a code, the bars on a 0–100 scale with the names in
 * the table, the count beside the ranks, and the report on screen as well as in the PDF and Excel.
 */
export async function ToppersReport({
  sp,
}: {
  sp: {
    classLabel?: string;
    examYear?: string;
    compare?: string;
    gender?: string;
    method?: string;
    section?: string;
    show?: string;
    codes?: string | string[];
    top?: string;
    low?: string;
    pctOp?: string;
    pct?: string;
  };
}) {
  const b = await getTranslations('boardResults');
  const cls = sp.classLabel === 'XII' ? 'XII' : 'X';
  const f = new URLSearchParams({ classLabel: cls });
  if (/^\d{4}$/.test(sp.examYear ?? '')) f.set('examYear', sp.examYear!);
  if (/^[0-4]$/.test(sp.compare ?? '')) f.set('compare', sp.compare!);
  if (sp.method === 'all' || sp.method === 'first5') f.set('method', sp.method);
  if (sp.gender === 'M' || sp.gender === 'F') f.set('gender', sp.gender);
  if (sp.section && /^[\w -]{1,40}$/.test(sp.section)) f.set('section', sp.section);
  if (sp.show === 'overall' || sp.show === 'subjects') f.set('show', sp.show);
  // the subjects ticked arrive as several values (or one list from a link)
  const codes = [sp.codes ?? []]
    .flat()
    .flatMap((c) => c.split(','))
    .filter((c) => /^\d{3}$/.test(c));
  if (codes.length) f.set('codes', [...new Set(codes)].slice(0, 80).join(','));
  if (/^\d{1,2}$/.test(sp.top ?? '')) f.set('top', String(Math.min(50, Number(sp.top))));
  if (/^\d{1,2}$/.test(sp.low ?? '')) f.set('low', String(Math.min(50, Number(sp.low))));
  if ((sp.pctOp === 'gte' || sp.pctOp === 'lte') && /^\d{1,3}(\.\d{1,2})?$/.test(sp.pct ?? '')) {
    f.set('pctOp', sp.pctOp);
    f.set('pct', String(Math.min(100, Number(sp.pct))));
  }
  const d = await apiFetch<BoardToppers>(`/exams/board-results/reports/toppers?${f.toString()}`);
  const fileQ = new URLSearchParams(f);
  if (d.examYear) fileQ.set('examYear', String(d.examYear));
  const r = d.report;
  const asked = d.top > 0 || d.low > 0 || d.pctOp !== null;
  const aggregateWords =
    d.method === 'best5'
      ? b('rs_ruleBest5', { rule: d.rule })
      : d.method === 'first5'
        ? b('rs_ruleFirst5')
        : b('rs_ruleAll');
  const scope = [
    `Class ${cls}`,
    d.examYear ? `${String(d.examYear)} (${yearLabel(d.examYear)})` : '',
    d.section ? `${b('section')} ${d.section}` : b('an_allSections'),
    d.gender === 'M' ? b('rp_boys') : d.gender === 'F' ? b('rp_girls') : b('rp_genderAll'),
  ]
    .filter(Boolean)
    .join(' · ');

  const listTitle = (l: BoardTopperList) =>
    l.kind === 'top'
      ? b('tp_listTop', { ranks: l.ranks ?? 0, n: l.rows.length })
      : l.kind === 'low'
        ? b('tp_listLow', { ranks: l.ranks ?? 0, n: l.rows.length })
        : b(d.pctOp === 'lte' ? 'tp_listLte' : 'tp_listGte', {
            pct: String(d.pct ?? 0),
            n: l.rows.length,
          });

  const ListTable = ({
    block,
    list,
    id,
  }: {
    block: BoardToppersBlock;
    list: BoardTopperList;
    id: string;
  }) => {
    const aggregate = block.code === null;
    const classRank = list.rows.some((x) => x.classRank !== null);
    const caption = `${aggregate ? b('tp_class') : `${block.name} (${block.code ?? ''})`} · ${listTitle(list)}`;
    return (
      <section aria-labelledby={id} style={{ marginTop: 'var(--sp-3)' }}>
        <h4 id={id} className="ep-field__label" style={{ margin: '0 0 var(--sp-1)' }}>
          {listTitle(list)}
        </h4>
        {!list.rows.length ? (
          <p className="ep-field__help" style={{ margin: 0 }}>
            {b('tp_none')}
          </p>
        ) : (
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label={caption}>
            <table className="ep-table" data-density="dense">
              <caption className="ep-sr-only">{caption}</caption>
              <thead>
                <tr>
                  <th scope="col" style={{ textAlign: 'center' }}>
                    {b('rs_rank')}
                  </th>
                  {classRank ? (
                    <th scope="col" style={{ textAlign: 'center' }}>
                      {b('tp_classRank')}
                    </th>
                  ) : null}
                  <th scope="col">{b('rollNo')}</th>
                  <th scope="col">{b('rs_name')}</th>
                  <th scope="col">{b('rs_gender')}</th>
                  <th scope="col">{b('section')}</th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    {b('tp_marks')}
                  </th>
                  {aggregate ? (
                    <th scope="col" style={{ textAlign: 'right' }}>
                      %
                    </th>
                  ) : (
                    <th scope="col">{b('tp_grade')}</th>
                  )}
                  <th scope="col">{b('tp_bar')}</th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((x) => (
                  <tr key={x.roll}>
                    <td style={{ textAlign: 'center' }}>{x.rank}</td>
                    {classRank ? (
                      <td style={{ textAlign: 'center' }}>{x.classRank ?? '—'}</td>
                    ) : null}
                    <td>{x.roll}</td>
                    <td>{x.name ?? '—'}</td>
                    <td>{x.sex === 'M' ? b('tp_boy') : x.sex === 'F' ? b('tp_girl') : '—'}</td>
                    <td>{x.section ?? '—'}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {aggregate ? `${String(x.marks)} / ${String(x.max)}` : x.marks}
                    </td>
                    {aggregate ? (
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {`${pctText(x.pct, true)}%`}
                      </td>
                    ) : (
                      <td>{x.grade ?? '—'}</td>
                    )}
                    <td style={{ minWidth: '5rem' }}>
                      <Bar value={x.pct} tone={LIST_TONES[list.kind]} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    );
  };

  const Block = ({ block, id }: { block: BoardToppersBlock; id: string }) => (
    <section aria-labelledby={id} style={{ minWidth: 0 }}>
      <h3 id={id} className="ep-cdash__h3" style={{ margin: 0 }}>
        {block.code === null ? b('tp_class') : `${block.name} (${block.code})`}
      </h3>
      <p className="ep-field__help" style={{ margin: 'var(--sp-1) 0 0' }}>
        {block.code === null
          ? `${b('tp_ranked', { n: block.appeared })} · ${aggregateWords}`
          : b('tp_appeared', { n: block.appeared })}
      </p>
      {block.lists.map((l) => (
        <ListTable key={l.kind} block={block} list={l} id={`${id}-${l.kind}`} />
      ))}
    </section>
  );

  return (
    <>
      <Card title={b('rp_toppers')}>
        <p className="ep-field__help" style={{ marginTop: 0 }}>
          {b('rp_toppersHelp')}
        </p>
        <form
          method="get"
          action="/exams/board-results"
          style={{ display: 'grid', gap: 'var(--sp-3)' }}
        >
          <input type="hidden" name="tab" value="reports" />
          <input type="hidden" name="report" value="toppers" />
          <div
            style={{
              display: 'flex',
              gap: 'var(--sp-3)',
              flexWrap: 'wrap',
              alignItems: 'flex-end',
            }}
          >
            <SelectField
              id="tp-class"
              name="classLabel"
              label={b('an_class')}
              required
              defaultValue={cls}
              options={[
                { value: 'X', label: 'Class X' },
                { value: 'XII', label: 'Class XII' },
              ]}
            />
            <SelectField
              id="tp-year"
              name="examYear"
              label={b('an_year')}
              required
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
              id="tp-section"
              name="section"
              label={b('section')}
              defaultValue={d.section ?? ''}
              options={[
                { value: '', label: b('an_allSections') },
                ...d.sections.map((s) => ({ value: s, label: s })),
              ]}
            />
            <SelectField
              id="tp-gender"
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
              id="tp-method"
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
              id="tp-show"
              name="show"
              label={b('tp_show')}
              defaultValue={d.show}
              options={[
                { value: 'both', label: b('tp_showBoth') },
                { value: 'overall', label: b('tp_showOverall') },
                { value: 'subjects', label: b('tp_showSubjects') },
              ]}
            />
          </div>
          <div
            style={{
              display: 'flex',
              gap: 'var(--sp-3)',
              flexWrap: 'wrap',
              alignItems: 'flex-end',
            }}
          >
            <InputField
              id="tp-top"
              name="top"
              type="number"
              min={0}
              max={50}
              label={b('tp_top')}
              help={b('tp_zeroNone')}
              defaultValue={String(d.top)}
              style={{ maxWidth: '8rem' }}
            />
            <InputField
              id="tp-low"
              name="low"
              type="number"
              min={0}
              max={50}
              label={b('tp_low')}
              help={b('tp_zeroNone')}
              defaultValue={String(d.low)}
              style={{ maxWidth: '8rem' }}
            />
            <SelectField
              id="tp-pctop"
              name="pctOp"
              label={b('tp_pctList')}
              defaultValue={d.pctOp ?? ''}
              options={[
                { value: '', label: b('tp_pctNone') },
                { value: 'gte', label: b('tp_gte') },
                { value: 'lte', label: b('tp_lte') },
              ]}
            />
            <InputField
              id="tp-pct"
              name="pct"
              type="number"
              min={0}
              max={100}
              step="0.01"
              label={b('tp_pctValue')}
              defaultValue={d.pct === null ? '90' : String(d.pct)}
              style={{ maxWidth: '8rem' }}
            />
            <SelectField
              id="tp-compare"
              name="compare"
              label={b('rp_compare')}
              defaultValue={String(d.compare)}
              options={[0, 1, 2, 3, 4].map((n) => ({
                value: String(n),
                label: b('rp_compareN', { n }),
              }))}
            />
          </div>
          <details>
            <summary className="ep-field__label">
              {d.codes.length ? b('tp_subjectsN', { n: d.codes.length }) : b('tp_subjectsAll')}
            </summary>
            <p className="ep-field__help">{b('tp_subjectsHelp')}</p>
            <fieldset
              style={{
                border: 0,
                padding: 0,
                margin: 0,
                display: 'grid',
                gap: 'var(--sp-2)',
                gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 240px), 1fr))',
              }}
            >
              <legend className="ep-sr-only">{b('tp_subjects')}</legend>
              {d.subjects.map((s) => (
                <Checkbox
                  key={s.code}
                  id={`tp-code-${s.code}`}
                  name="codes"
                  value={s.code}
                  defaultChecked={d.codes.includes(s.code)}
                  label={`${s.code} ${s.name}`}
                />
              ))}
            </fieldset>
          </details>
          <div>
            <Button type="submit" size="sm">
              {b('an_show')}
            </Button>
          </div>
        </form>
      </Card>

      {!r || !d.examYear ? (
        <Card title={b('an_noneTitle')}>
          <p style={{ margin: 0 }}>
            {b('an_none', { cls })}{' '}
            <a href="/exams/board-results?tab=upload" style={{ textDecoration: 'underline' }}>
              {b('tab_upload')}
            </a>
          </p>
        </Card>
      ) : (
        <>
          <Card
            title={b('rp_toppersTitle')}
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
                  href={`/exams/board-results/reports/toppers/pdf?${fileQ.toString()}`}
                  label={b('rp_toppersTitle')}
                />
                <a
                  className="ep-btn ep-btn--secondary ep-btn--sm"
                  href={`/exams/board-results/reports/toppers/xlsx?${fileQ.toString()}`}
                >
                  {b('rs_excel')}
                </a>
              </span>
            }
          >
            <p className="ep-field__help" style={{ marginTop: 0 }}>
              {`${scope}. ${b('tp_note')}`}
            </p>
            {!asked ? (
              <p style={{ margin: 0 }}>{b('tp_nothing')}</p>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gap: 'var(--sp-5)',
                  gridTemplateColumns: 'minmax(0, 1fr)',
                }}
              >
                {r.overall ? <Block block={r.overall} id="tp-overall" /> : null}
                {r.subjects.length ? (
                  <section aria-labelledby="tp-subjects">
                    <h3
                      id="tp-subjects"
                      className="ep-cdash__h3"
                      style={{ margin: '0 0 var(--sp-3)' }}
                    >
                      {b('tp_subjectToppers')}
                    </h3>
                    <div
                      style={{
                        display: 'grid',
                        gap: 'var(--sp-5)',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 560px), 1fr))',
                      }}
                    >
                      {r.subjects.map((s) => (
                        <Block key={s.code} block={s} id={`tp-s-${s.code ?? ''}`} />
                      ))}
                    </div>
                  </section>
                ) : null}
              </div>
            )}
          </Card>
          {r.years.length > 1 ? (
            <Card title={b('tp_years')}>
              <p className="ep-field__help" style={{ marginTop: 0 }}>
                {b('tp_yearsHelp', { n: Math.max(1, d.top) })}
              </p>
              <BarChart
                title={b('tp_years')}
                data={r.years.map((y) => ({
                  label: y.label,
                  values: [y.highest ?? 0, y.cutoff ?? 0],
                }))}
                series={[
                  { label: b('tp_highest'), tone: 'navy' },
                  { label: b('tp_cutoff', { n: Math.max(1, d.top) }), tone: 'cyan' },
                ]}
                max={100}
                suffix="%"
              />
              <div className="ep-table-wrap" tabIndex={0} role="region" aria-label={b('tp_years')}>
                <table className="ep-table" data-density="dense">
                  <caption className="ep-sr-only">{b('tp_years')}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{b('an_year')}</th>
                      {[
                        b('tp_rankedCol'),
                        b('tp_highest'),
                        b('tp_atFirst'),
                        b('tp_cutoff', { n: Math.max(1, d.top) }),
                        b('tp_inTop', { n: Math.max(1, d.top) }),
                        b('tp_95'),
                        b('tp_90'),
                      ].map((h) => (
                        <th key={h} scope="col" style={{ textAlign: 'right' }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {r.years.map((y) => (
                      <tr key={y.examYear}>
                        <td>{y.label}</td>
                        {[
                          y.appeared,
                          y.highest === null ? '—' : `${y.highest.toFixed(2)}%`,
                          y.atFirst,
                          y.cutoff === null ? '—' : `${y.cutoff.toFixed(2)}%`,
                          y.inTop,
                          y.pct95,
                          y.pct90,
                        ].map((v, i) => (
                          <td key={String(i)} style={{ textAlign: 'right' }}>
                            {v}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : null}
        </>
      )}
    </>
  );
}
