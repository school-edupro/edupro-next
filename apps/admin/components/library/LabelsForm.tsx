'use client';
import { FormRow, FormSection, InputField, SelectField } from '@edupro/ui';
import { useRef, useState, useTransition } from 'react';
import { countLabels } from '@/lib/library-books-actions';
import type { LabelCount, LabelSetup } from '@/lib/library-books';

type Source = 'range' | 'list' | 'added' | 'title';
interface Custom {
  cols: string;
  rows: string;
  width: string;
  height: string;
  top: string;
  left: string;
  gapX: string;
  gapY: string;
}
const CUSTOM_FIELDS: Array<[keyof Custom, string]> = [
  ['cols', 'Across'],
  ['rows', 'Down'],
  ['width', 'Label width (mm)'],
  ['height', 'Label height (mm)'],
  ['top', 'Top margin (mm)'],
  ['left', 'Left margin (mm)'],
  ['gapX', 'Gap across (mm)'],
  ['gapY', 'Gap down (mm)'],
];

/**
 * Barcode and spine labels (docs/design/36-library.md, part 5): which copies (an accession range, a
 * list typed or scanned, the copies added between two days, a title's copies), which labels (barcode,
 * spine, both; the line above; the title; how many of each), the sheet (a preset or one measured) and
 * the label to start at on a used sheet; a count first, then the PDF to open or save.
 */
export function LabelsForm({
  setup,
  initial,
}: {
  setup: LabelSetup;
  initial: {
    source: Source;
    from?: string;
    to?: string;
    list?: string;
    titleId?: string;
    title?: string;
  };
}) {
  const last = setup.last ?? {};
  const [source, setSource] = useState<Source>(initial.source);
  const [from, setFrom] = useState(initial.from ?? '');
  const [to, setTo] = useState(initial.to ?? '');
  const [list, setList] = useState(initial.list ?? '');
  const [addedFrom, setAddedFrom] = useState('');
  const [addedTo, setAddedTo] = useState('');
  const [libraryId, setLibraryId] = useState('');
  const [withdrawn, setWithdrawn] = useState(false);
  const [kind, setKind] = useState<'barcode' | 'spine' | 'both'>(last.kind ?? 'barcode');
  const [top, setTop] = useState<'library' | 'school' | 'none'>(last.top ?? 'library');
  const [showTitle, setShowTitle] = useState(last.showTitle ?? true);
  const [copies, setCopies] = useState(String(last.copies ?? 1));
  const [preset, setPreset] = useState(last.preset ?? setup.presets[0]!.id);
  const base = setup.presets.find((p) => p.id === preset) ?? setup.presets[0]!;
  const [custom, setCustom] = useState<Custom>(() => {
    const c = (last.custom ?? base) as Record<string, number>;
    return Object.fromEntries(
      CUSTOM_FIELDS.map(([k]) => [k, String(c[k] ?? '')]),
    ) as unknown as Custom;
  });
  const [start, setStart] = useState(1);
  const [count, setCount] = useState<LabelCount | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, run] = useTransition();
  const form = useRef<HTMLFormElement>(null);
  const [save, setSave] = useState(false);

  const sheet =
    preset === 'custom'
      ? { cols: Number(custom.cols) || 1, rows: Number(custom.rows) || 1 }
      : { cols: base.cols, rows: base.rows };
  const per = sheet.cols * sheet.rows;
  const body = () => ({
    source,
    ...(source === 'range'
      ? { ...(from.trim() ? { from: from.trim() } : {}), ...(to.trim() ? { to: to.trim() } : {}) }
      : {}),
    ...(source === 'list'
      ? {
          list: list
            .split(/[\s,;]+/)
            .map((x) => x.trim())
            .filter(Boolean),
        }
      : {}),
    ...(source === 'added'
      ? { ...(addedFrom ? { addedFrom } : {}), ...(addedTo ? { addedTo } : {}) }
      : {}),
    ...(source === 'title' ? { titleId: initial.titleId } : {}),
    ...(libraryId && (source === 'range' || source === 'added') ? { libraryId } : {}),
    includeWithdrawn: withdrawn,
    kind,
    top,
    showTitle,
    copies: Number(copies) || 1,
    preset,
    ...(preset === 'custom'
      ? {
          custom: Object.fromEntries(CUSTOM_FIELDS.map(([k]) => [k, Number(custom[k]) || 0])),
        }
      : {}),
    skip: Math.min(per - 1, Math.max(0, start - 1)),
  });
  const check = () =>
    run(async () => {
      setError(null);
      const r = await countLabels(body());
      if (!r.ok) {
        setCount(null);
        setError(r.error);
        return;
      }
      setCount(r);
    });
  const print = (asFile: boolean) => {
    setSave(asFile);
    // the hidden form carries the choice; the PDF opens in a new tab (or is saved)
    requestAnimationFrame(() => form.current?.requestSubmit());
  };
  const changed = () => setCount(null);

  return (
    <>
      <FormSection title="Which copies">
        <fieldset className="ep-field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="ep-field__label">Copies of</legend>
          <div className="ep-book__choices">
            {(
              [
                ['range', 'Accession numbers from – to'],
                ['list', 'A list (typed or scanned)'],
                ['added', 'Copies added between two days'],
                ...(initial.titleId ? [['title', `This title: ${initial.title ?? ''}`]] : []),
              ] as Array<[Source, string]>
            ).map(([k, label]) => (
              <label key={k} className="ep-check" htmlFor={`lb-src-${k}`}>
                <input
                  id={`lb-src-${k}`}
                  type="radio"
                  name="lb-source"
                  checked={source === k}
                  onChange={() => {
                    setSource(k);
                    changed();
                  }}
                />{' '}
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        {source === 'range' ? (
          <FormRow columns={3}>
            <InputField
              id="lb-from"
              label="From"
              maxLength={30}
              placeholder="B00001"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                changed();
              }}
            />
            <InputField
              id="lb-to"
              label="To"
              maxLength={30}
              placeholder="B00100"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                changed();
              }}
              help="The same prefix as From"
            />
          </FormRow>
        ) : null}
        {source === 'list' ? (
          <label className="ep-field" htmlFor="lb-list" style={{ margin: 0 }}>
            <span className="ep-field__label">Accession numbers</span>
            <textarea
              id="lb-list"
              className="ep-input"
              rows={4}
              maxLength={60000}
              value={list}
              onChange={(e) => {
                setList(e.target.value);
                changed();
              }}
            />
            <span className="ep-field__help">
              Separated by commas, spaces or new lines; a scanner adds one per line. Printed in this
              order.
            </span>
          </label>
        ) : null}
        {source === 'added' ? (
          <FormRow columns={3}>
            <InputField
              id="lb-added-from"
              label="Added from"
              type="date"
              value={addedFrom}
              onChange={(e) => {
                setAddedFrom(e.target.value);
                changed();
              }}
            />
            <InputField
              id="lb-added-to"
              label="Added to"
              type="date"
              value={addedTo}
              onChange={(e) => {
                setAddedTo(e.target.value);
                changed();
              }}
            />
          </FormRow>
        ) : null}
        {source === 'range' || source === 'added' ? (
          <FormRow columns={3}>
            <SelectField
              id="lb-library"
              label="Library"
              value={libraryId}
              onChange={(e) => {
                setLibraryId(e.target.value);
                changed();
              }}
              options={[
                { value: '', label: 'All' },
                ...setup.libraries.map((l) => ({ value: l.id, label: l.name })),
              ]}
            />
          </FormRow>
        ) : null}
        <label className="ep-check" htmlFor="lb-withdrawn">
          <input
            id="lb-withdrawn"
            type="checkbox"
            checked={withdrawn}
            onChange={(e) => {
              setWithdrawn(e.target.checked);
              changed();
            }}
          />{' '}
          Withdrawn copies too
        </label>
      </FormSection>

      <FormSection title="The labels">
        <fieldset className="ep-field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="ep-field__label">For each copy</legend>
          <div className="ep-book__choices">
            {(
              [
                [
                  'barcode',
                  'Barcode label (the accession number as bars, the number, the call number)',
                ],
                ['spine', 'Spine label (the call number in lines, the accession number)'],
                ['both', 'Both, one after the other'],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="ep-check" htmlFor={`lb-kind-${k}`}>
                <input
                  id={`lb-kind-${k}`}
                  type="radio"
                  name="lb-kind"
                  checked={kind === k}
                  onChange={() => {
                    setKind(k);
                    changed();
                  }}
                />{' '}
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <FormRow columns={3}>
          <SelectField
            id="lb-top"
            label="Line above the barcode"
            value={top}
            onChange={(e) => setTop(e.target.value as typeof top)}
            options={[
              { value: 'library', label: 'The library’s name' },
              { value: 'school', label: 'The school’s name' },
              { value: 'none', label: 'Nothing' },
            ]}
          />
          <SelectField
            id="lb-copies"
            label="Labels of each"
            value={copies}
            onChange={(e) => {
              setCopies(e.target.value);
              changed();
            }}
            options={[1, 2, 3].map((n) => ({ value: String(n), label: String(n) }))}
          />
          <label className="ep-check" htmlFor="lb-title" style={{ alignSelf: 'end' }}>
            <input
              id="lb-title"
              type="checkbox"
              checked={showTitle}
              onChange={(e) => setShowTitle(e.target.checked)}
            />{' '}
            The title on the barcode label (when there is room)
          </label>
        </FormRow>
      </FormSection>

      <FormSection title="The sheet" description="Print at actual size (100%), not “fit to page”.">
        <FormRow columns={2}>
          <SelectField
            id="lb-preset"
            label="Label sheet"
            value={preset}
            onChange={(e) => {
              setPreset(e.target.value);
              setStart(1);
              changed();
            }}
            options={[
              ...setup.presets.map((p) => ({ value: p.id, label: p.name })),
              { value: 'custom', label: 'My own measurements' },
            ]}
          />
          <InputField
            id="lb-start"
            label="Start at label"
            type="number"
            min={1}
            max={per}
            value={String(start)}
            onChange={(e) => {
              setStart(Math.min(per, Math.max(1, Number(e.target.value) || 1)));
              changed();
            }}
            help="On a sheet already used: the first label left, counted across then down"
          />
        </FormRow>
        {preset === 'custom' ? (
          <FormRow columns={4}>
            {CUSTOM_FIELDS.map(([k, label]) => (
              <InputField
                key={k}
                id={`lb-c-${k}`}
                label={label}
                type="number"
                min={0}
                step={k === 'cols' || k === 'rows' ? 1 : 0.1}
                value={custom[k]}
                onChange={(e) => {
                  setCustom((c) => ({ ...c, [k]: e.target.value }));
                  changed();
                }}
              />
            ))}
          </FormRow>
        ) : null}
        <div
          className="ep-book__sheet"
          style={{ gridTemplateColumns: `repeat(${String(sheet.cols)}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: Math.min(per, 300) }, (_, i) => (
            <button
              key={i}
              type="button"
              className={`ep-book__cell${i + 1 < start ? ' ep-book__cell--used' : ''}${i + 1 === start ? ' ep-book__cell--start' : ''}`}
              aria-label={`Start at label ${String(i + 1)}`}
              aria-pressed={i + 1 === start}
              onClick={() => {
                setStart(i + 1);
                changed();
              }}
            />
          ))}
        </div>
      </FormSection>

      {error ? (
        <p className="ep-alert ep-alert--danger" role="alert">
          {error}
        </p>
      ) : null}
      {count ? (
        <p className={`ep-alert ep-alert--${count.copies ? 'info' : 'warning'}`} role="status">
          <span>
            {count.copies
              ? `${String(count.copies)} cop${count.copies === 1 ? 'y' : 'ies'} (${count.first ?? ''} to ${count.last ?? ''}) · ${String(count.labels)} labels on ${String(count.sheets)} sheet${count.sheets === 1 ? '' : 's'}.`
              : 'No copy matches.'}
            {count.missing.length ? ` Not found: ${count.missing.join(', ')}.` : ''}
          </span>
        </p>
      ) : null}
      <div className="ep-form-actions">
        <button
          type="button"
          className="ep-btn ep-btn--secondary"
          disabled={pending}
          onClick={check}
        >
          {pending ? 'Counting…' : 'Count the labels'}
        </button>
        <button
          type="button"
          className="ep-btn ep-btn--primary"
          disabled={!count?.copies}
          onClick={() => print(false)}
        >
          Open the PDF
        </button>
        <button
          type="button"
          className="ep-btn ep-btn--ghost"
          disabled={!count?.copies}
          onClick={() => print(true)}
        >
          Download
        </button>
      </div>
      <form ref={form} method="post" action="/api/library-labels" target="_blank" hidden>
        <input type="hidden" name="body" value={JSON.stringify(body())} />
        {save ? <input type="hidden" name="save" value="1" /> : null}
      </form>
    </>
  );
}
