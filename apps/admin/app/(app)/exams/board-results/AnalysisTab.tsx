import { Button, Card, DataTable, KpiTile, SelectField } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { FileLinks } from '@/components/FileLinks';
import { FoldCard } from '@/components/FoldCard';
import { apiFetch } from '@/lib/api';
import {
  when,
  yearLabel,
  type AnCell,
  type AnTable,
  type BoardAnalysisView,
  type BestFiveRule,
} from '@/lib/board-results';

const BF_KEY: Record<BestFiveRule, string> = {
  'language-plus-four': 'bf_language',
  'english-plus-four': 'bf_english',
  'any-five': 'bf_any',
};

type Row = Record<string, AnCell> & { __i: number };

function AnnexTable({ t }: { t: AnTable }) {
  const rows: Row[] = t.rows.map((r, i) => ({ ...r, __i: i }));
  const strong = new Set(t.strong ?? []);
  return (
    <>
      <DataTable<Row>
        caption={t.title}
        density="dense"
        columns={t.columns.map((c) => ({
          key: c.key,
          header: c.group ? `${c.group} · ${c.label}` : c.label || '—',
          numeric: Boolean(c.num),
          render: (r: Row) => {
            const v = r[c.key];
            const s = v === null || v === undefined ? '' : String(v);
            return strong.has(r.__i) ? <strong>{s}</strong> : s;
          },
        }))}
        rows={rows}
        rowKey={(r) => String(r.__i)}
        emptyTitle="None"
      />
      {t.note ? (
        <p className="ep-field__help" style={{ marginBottom: 0 }}>
          {t.note}
        </p>
      ) : null}
    </>
  );
}

/**
 * The Analysis tab (docs/design/88, phase C): a saved year's ten annexures as the school's workbook lays them out —
 * class, examination, section and annexure to pick; the headline figures first; each table of the annexure (a long
 * run of them folded); the Excel workbook and the PDF; the rules counted with.
 */
export async function AnalysisTab({
  sp,
  canImport,
}: {
  sp: { classLabel?: string; examYear?: string; section?: string; annexure?: string };
  canImport: boolean;
}) {
  const b = await getTranslations('boardResults');
  const cls = sp.classLabel === 'XII' ? 'XII' : 'X';
  const q = new URLSearchParams({ classLabel: cls });
  if (/^\d{4}$/.test(sp.examYear ?? '')) q.set('examYear', sp.examYear!);
  const section = (sp.section ?? '').trim();
  if (section && section.length <= 40) q.set('section', section);
  const v = await apiFetch<BoardAnalysisView>(`/exams/board-results/analysis?${q.toString()}`);
  const no = /^([1-9]|1[0-3])$/.test(sp.annexure ?? '') ? Number(sp.annexure) : 1;
  const a = v.analysis;
  const ax = a?.annexures.find((x) => x.no === no) ?? a?.annexures[0];
  const fileQ = new URLSearchParams({ classLabel: cls });
  if (v.examYear) fileQ.set('examYear', String(v.examYear));
  if (v.section) fileQ.set('section', v.section);
  const link = (n: number) => {
    const x = new URLSearchParams(fileQ);
    x.set('tab', 'analysis');
    x.set('annexure', String(n));
    return `/exams/board-results?${x.toString()}`;
  };
  const h = a?.headline;
  // the first three tables open; a longer run (a table a section or a subject) folded after them
  const OPEN = 3;
  const many = (ax?.tables.length ?? 0) > OPEN;

  return (
    <div style={{ display: 'grid', gap: 'var(--sp-4)', gridTemplateColumns: 'minmax(0, 1fr)' }}>
      <Card title={b('analysis')}>
        <form
          method="get"
          action="/exams/board-results"
          style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap', alignItems: 'flex-end' }}
        >
          <input type="hidden" name="tab" value="analysis" />
          <SelectField
            id="an-class"
            name="classLabel"
            label={b('an_class')}
            defaultValue={cls}
            options={[
              { value: 'X', label: 'Class X' },
              { value: 'XII', label: 'Class XII' },
            ]}
          />
          <SelectField
            id="an-year"
            name="examYear"
            label={b('an_year')}
            defaultValue={v.examYear ? String(v.examYear) : ''}
            options={
              v.years.length
                ? v.years.map((y) => ({
                    value: String(y),
                    label: `${String(y)} (${yearLabel(y)})`,
                  }))
                : [{ value: '', label: '—' }]
            }
          />
          <SelectField
            id="an-section"
            name="section"
            label={b('an_section')}
            defaultValue={v.section ?? ''}
            options={[
              { value: '', label: b('an_allSections') },
              ...v.sections.map((s) => ({ value: s, label: s })),
            ]}
          />
          <SelectField
            id="an-annexure"
            name="annexure"
            label={b('an_annexure')}
            defaultValue={String(ax?.no ?? 1)}
            options={(a?.annexures ?? []).map((x) => ({
              value: String(x.no),
              label: `${String(x.no)}. ${x.title}`,
            }))}
          />
          <Button type="submit" size="sm">
            {b('an_show')}
          </Button>
        </form>
        {a ? (
          <p className="ep-field__help" style={{ marginBottom: 0 }}>
            {b('an_rules', {
              words: b(BF_KEY[v.rules.bestFive]),
              distinction: String(v.rules.distinction),
              pass: String(v.rules.passMarks),
              grades: b(v.rules.grades === 'marks' ? 'an_grades_marks' : 'an_grades_printed'),
            })}{' '}
            {canImport ? (
              <a
                href="/exams/board-results?tab=setup#rules"
                style={{ textDecoration: 'underline' }}
              >
                {b('an_rulesLink')}
              </a>
            ) : null}
            {v.file ? (
              <>
                {' '}
                {b('an_file', {
                  file: v.file.fileName ?? `#${v.file.id}`,
                  when: v.file.savedAt ? when(v.file.savedAt) : '—',
                })}
              </>
            ) : null}
          </p>
        ) : null}
      </Card>

      {!a || !h || !ax ? (
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
          <div className="ep-dash-kpis">
            <KpiTile label={b('an_registered')} value={String(h.registered)} />
            <KpiTile
              label={b('an_appeared')}
              value={String(h.appeared)}
              hint={h.absent ? b('an_absent', { n: h.absent }) : undefined}
            />
            <KpiTile
              label={b('an_passed')}
              value={String(h.passed)}
              hint={h.passPct === null ? undefined : `${String(h.passPct)}%`}
            />
            <KpiTile
              label={b('an_aggregate')}
              value={h.aggregate === null ? '—' : `${String(h.aggregate)}%`}
              hint={b('an_bestFive')}
            />
            <KpiTile
              label={b('an_n90')}
              value={String(h.n90)}
              hint={h.pct90 === null ? undefined : `${String(h.pct90)}%`}
            />
            <KpiTile
              label={b('an_n75')}
              value={String(h.n75)}
              hint={h.pct75 === null ? undefined : `${String(h.pct75)}%`}
            />
          </div>

          <nav className="ep-tabs-links" aria-label={b('an_annexures')}>
            {a.annexures.map((x) => (
              <a key={x.no} href={link(x.no)} aria-current={x.no === ax.no ? 'page' : undefined}>
                {`${String(x.no)}. ${x.title}`}
              </a>
            ))}
          </nav>

          <Card title={`${b('an_annexure')} ${String(ax.no)}: ${ax.title}`}>
            <div
              style={{
                display: 'flex',
                gap: 'var(--sp-3)',
                alignItems: 'center',
                flexWrap: 'wrap',
                justifyContent: 'space-between',
                marginBottom: 'var(--sp-3)',
              }}
            >
              <span className="ep-field__help">
                {`CBSE ${a.classLabel === 'XII' ? 'AISSCE' : 'AISSE'} ${yearLabel(a.examYear)} · Class ${a.classLabel}${v.section ? ` · ${b('an_section')} ${v.section}` : ''}`}
              </span>
              <span
                style={{
                  display: 'inline-flex',
                  gap: 'var(--sp-3)',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                }}
              >
                <span className="ep-field__help">{b('an_pdfThis')}</span>
                <FileLinks
                  href={`/exams/board-results/analysis/pdf?${fileQ.toString()}&annexure=${String(ax.no)}`}
                  label={`${b('an_annexure')} ${String(ax.no)} PDF`}
                />
                <span className="ep-field__help">{b('an_pdfAll')}</span>
                <FileLinks
                  href={`/exams/board-results/analysis/pdf?${fileQ.toString()}`}
                  label={b('an_pdfAll')}
                />
                <a
                  className="ep-btn ep-btn--secondary ep-btn--sm"
                  href={`/exams/board-results/analysis/xlsx?${fileQ.toString()}`}
                >
                  {b('an_excel')}
                </a>
              </span>
            </div>
            <div
              style={{ display: 'grid', gap: 'var(--sp-4)', gridTemplateColumns: 'minmax(0, 1fr)' }}
            >
              {ax.tables.slice(0, OPEN).map((t) => (
                <section key={t.key} aria-label={t.title}>
                  <h3 className="ep-h4" style={{ margin: '0 0 var(--sp-2)' }}>
                    {t.title}
                  </h3>
                  <AnnexTable t={t} />
                </section>
              ))}
            </div>
          </Card>
          {many
            ? ax.tables.slice(OPEN).map((t) => (
                <FoldCard
                  key={t.key}
                  id={`an-${t.key}`}
                  title={t.title}
                  hint={b('an_rows', { n: t.rows.length })}
                >
                  <AnnexTable t={t} />
                </FoldCard>
              ))
            : null}
        </>
      )}
    </div>
  );
}
