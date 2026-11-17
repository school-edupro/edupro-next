import { Badge, Button, Card, DataTable, InputField } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { ConfirmAction } from '@/components/ConfirmAction';
import { DialogButton } from '@/components/leave/DialogButton';
import { removeBoardYearFigures, saveBoardYearFigures } from '@/lib/board-actions';
import {
  yearLabel,
  YEAR_SUBJECT_FIELDS,
  type BoardYearFigures,
  type BoardYearSubject,
} from '@/lib/board-results';

type Row = BoardYearFigures['rows'][number];

/** A typed year's subjects as the lines the form takes back: the code, then the figures. */
const linesOf = (subjects: BoardYearSubject[]) =>
  subjects
    .map((s) =>
      [
        s.code,
        ...YEAR_SUBJECT_FIELDS.map((k) =>
          s[k] === null || s[k] === undefined ? '' : String(s[k]),
        ),
      ]
        .join(', ')
        .replace(/(, )+$/, ''),
    )
    .join('\n');

/**
 * Set-up → Earlier years' figures (docs/design/88, phase E): a year whose CBSE result file is lost, typed in — the
 * headline for the five-year rows and the trend, each subject's figures for Annexure 5. A year whose file is saved
 * takes its figures from the file (the typed ones are then only kept).
 */
export async function YearFiguresCard({
  data,
  canImport,
}: {
  data: BoardYearFigures;
  canImport: boolean;
}) {
  const b = await getTranslations('boardResults');
  const cls = data.classLabel;
  const form = (r: Row | null) => (
    <form action={saveBoardYearFigures} className="ep-cert-fields">
      <input type="hidden" name="classLabel" value={cls} />
      <p className="ep-field__help" style={{ gridColumn: '1 / -1', margin: 0 }}>
        {b('yf_formHelp', { cls })}
      </p>
      {r ? <input type="hidden" name="examYear" value={String(r.examYear)} /> : null}
      <InputField
        id={`yf-year-${r?.id ?? 'new'}`}
        name={r ? 'examYearShown' : 'examYear'}
        type="number"
        min={2000}
        max={2100}
        label={b('yf_year')}
        required
        disabled={Boolean(r)}
        defaultValue={r ? String(r.examYear) : ''}
      />
      {(
        [
          ['registered', 'yf_registered', r?.registered],
          ['appeared', 'yf_appeared', r?.appeared],
          ['passed', 'yf_passed', r?.passed],
          ['compartments', 'yf_comp', r?.compartments],
          ['failures', 'yf_fail', r?.failures],
          ['n90', 'yf_n90', r?.n90],
          ['n75', 'yf_n75', r?.n75],
          ['aggregate', 'yf_aggregate', r?.aggregate],
          ['pi', 'yf_pi', r?.pi],
        ] as const
      ).map(([name, label, v]) => (
        <InputField
          key={name}
          id={`yf-${name}-${r?.id ?? 'new'}`}
          name={name}
          type="number"
          min={0}
          step={name === 'aggregate' || name === 'pi' ? '0.01' : '1'}
          label={b(label)}
          required={name === 'appeared'}
          defaultValue={v === null || v === undefined ? '' : String(v)}
        />
      ))}
      <label
        className="ep-field"
        htmlFor={`yf-subjects-${r?.id ?? 'new'}`}
        style={{ gridColumn: '1 / -1' }}
      >
        <span className="ep-field__label">{b('yf_subjects')}</span>
        <textarea
          id={`yf-subjects-${r?.id ?? 'new'}`}
          name="subjects"
          className="ep-input"
          rows={6}
          defaultValue={r ? linesOf(r.subjects) : ''}
          aria-describedby={`yf-subjects-help-${r?.id ?? 'new'}`}
        />
        <span id={`yf-subjects-help-${r?.id ?? 'new'}`} className="ep-field__help">
          {b('yf_subjectsHelp', {
            codes: data.subjects
              .slice(0, 6)
              .map((s) => `${s.code} ${s.name}`)
              .join(', '),
          })}
        </span>
      </label>
      <label
        className="ep-field"
        htmlFor={`yf-note-${r?.id ?? 'new'}`}
        style={{ gridColumn: '1 / -1' }}
      >
        <span className="ep-field__label">{b('yf_note')}</span>
        <input
          id={`yf-note-${r?.id ?? 'new'}`}
          name="note"
          className="ep-input"
          maxLength={500}
          defaultValue={r?.note ?? ''}
        />
      </label>
      <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end' }}>
        <Button type="submit" size="sm">
          {b('yf_save')}
        </Button>
      </div>
    </form>
  );

  return (
    <Card
      title={b('yf_title')}
      id="figures"
      style={{ marginTop: 'var(--sp-5)' }}
      actions={
        <span
          style={{
            display: 'inline-flex',
            gap: 'var(--sp-3)',
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <nav className="ep-tabs-links" aria-label={b('yf_title')}>
            {(['X', 'XII'] as const).map((x) => (
              <a
                key={x}
                href={`/exams/board-results?tab=setup&figures=${x}#figures`}
                aria-current={x === cls ? 'page' : undefined}
              >
                {`Class ${x}`}
              </a>
            ))}
          </nav>
          {canImport ? (
            <DialogButton
              id="yf-add"
              className="ep-btn ep-btn--secondary ep-btn--sm"
              label={b('yf_add')}
              title={`${b('yf_add')} · Class ${cls}`}
            >
              {form(null)}
            </DialogButton>
          ) : null}
        </span>
      }
    >
      <p className="ep-field__help" style={{ marginTop: 0 }}>
        {b('yf_help')}
      </p>
      <DataTable<Row>
        caption={`${b('yf_title')} · Class ${cls}`}
        density="dense"
        columns={[
          {
            key: 'y',
            header: b('yf_year'),
            render: (r) => (
              <>
                <strong>{`${String(r.examYear)} (${yearLabel(r.examYear)})`}</strong>
                {r.fileSaved ? (
                  <>
                    {' '}
                    <Badge tone="info">{b('yf_fileSaved')}</Badge>
                  </>
                ) : null}
              </>
            ),
          },
          { key: 'a', header: b('yf_appeared'), numeric: true, render: (r) => String(r.appeared) },
          {
            key: 'p',
            header: b('yf_passed'),
            numeric: true,
            render: (r) => (r.passed === null ? '' : String(r.passed)),
          },
          {
            key: '9',
            header: b('yf_n90'),
            numeric: true,
            render: (r) => (r.n90 === null ? '' : String(r.n90)),
          },
          {
            key: '7',
            header: b('yf_n75'),
            numeric: true,
            render: (r) => (r.n75 === null ? '' : String(r.n75)),
          },
          {
            key: 'g',
            header: b('yf_aggregate'),
            numeric: true,
            render: (r) => (r.aggregate === null ? '' : String(r.aggregate)),
          },
          {
            key: 'i',
            header: b('yf_pi'),
            numeric: true,
            render: (r) => (r.pi === null ? '' : String(r.pi)),
          },
          {
            key: 's',
            header: b('yf_subjectsCount'),
            numeric: true,
            render: (r) => String(r.subjects.length),
          },
          {
            key: 'x',
            header: b('actions'),
            render: (r) =>
              canImport ? (
                <span style={{ display: 'inline-flex', gap: 'var(--sp-2)' }}>
                  <DialogButton
                    id={`yf-${r.id}`}
                    className="ep-btn ep-btn--ghost ep-btn--sm"
                    label={
                      <>
                        {b('edit')}
                        <span className="ep-sr-only"> {String(r.examYear)}</span>
                      </>
                    }
                    title={`Class ${cls} ${String(r.examYear)}`}
                  >
                    {form(r)}
                  </DialogButton>
                  <ConfirmAction
                    action={removeBoardYearFigures}
                    fields={{ id: r.id, classLabel: cls }}
                    label={b('yf_remove')}
                    title={`${b('yf_remove')} · Class ${cls} ${String(r.examYear)}`}
                    confirmLabel={b('yf_remove')}
                    variant="ghost"
                  >
                    {b('yf_removeHelp')}
                  </ConfirmAction>
                </span>
              ) : null,
          },
        ]}
        rows={data.rows}
        rowKey={(r) => r.id}
        emptyTitle={b('yf_none')}
      />
    </Card>
  );
}
