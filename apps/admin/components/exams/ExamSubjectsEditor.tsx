'use client';
import { Button } from '@edupro/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { saveClassSetup, type PartsInput, type SubjectInput } from '@/lib/exam-hub-actions';

export interface EditorPart {
  id?: string;
  name: string;
  subjectId: string;
  max: string;
  entered: number;
}
export interface EditorRow {
  subjectId: string;
  code: string;
  name: string;
  on: boolean;
  max: string;
  pass: string;
  elective: boolean;
  scaleId: string;
  examOn: string | null;
  startsAt: string | null;
  endsAt: string | null;
  entryLocked: boolean;
  parts: EditorPart[];
  children: Array<{ id: string; code: string; name: string }>;
}
interface Option {
  id: string;
  code: string;
  name: string;
  /** its sub-subjects in the subject master */
  children?: Array<{ id: string; code: string; name: string }>;
}
/** the part names offered besides a subject's sub-subjects */
const PRESETS = ['Theory', 'Practical'] as const;

const partsKey = (p: EditorPart[]) =>
  JSON.stringify(
    p
      .filter((x) => x.name.trim() && Number(x.max) > 0)
      .map((x) => [x.id, x.name, x.subjectId, x.max]),
  );

/**
 * A class's subjects in an exam (docs/design/66), saved together with their parts and the class's
 * progress card set: tick what the class sits, set the marks (or apply one maximum and pass mark to
 * every ticked subject), copy another class's, split a subject into parts in its row. Unsaved changes
 * are kept on screen and the page asks before it is left.
 */
export function ExamSubjectsEditor({
  examId,
  classId,
  classCode,
  initial,
  fromClassList,
  addable,
  scales,
  sets,
  setId,
  copySources,
  next,
  locked,
}: {
  examId: string;
  classId: string;
  classCode: string;
  initial: EditorRow[];
  fromClassList: boolean;
  addable: Option[];
  scales: Option[];
  sets: Array<Option & { kind: string }>;
  setId: string | null;
  copySources: Array<{ classId: string; classCode: string; rows: EditorRow[] }>;
  next: { href: string; label: string } | null;
  locked: boolean;
}) {
  const t = useTranslations('examHub.setup');
  const leaving = useRef(false);
  const [rows, setRows] = useState<EditorRow[]>(initial);
  const [set, setSet] = useState(setId ?? '');
  const [allMax, setAllMax] = useState('');
  const [allPass, setAllPass] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const baseline = useMemo(() => JSON.stringify([initial, setId ?? '']), [initial, setId]);
  const dirty = JSON.stringify([rows, set]) !== baseline || fromClassList;

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      if (!leaving.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const initialParts = useMemo(
    () => new Map(initial.map((r) => [r.subjectId, partsKey(r.parts)])),
    [initial],
  );
  const change = (subjectId: string, patch: Partial<EditorRow>) =>
    setRows((rs) => rs.map((r) => (r.subjectId === subjectId ? { ...r, ...patch } : r)));
  const changePart = (subjectId: string, i: number, patch: Partial<EditorPart>) =>
    setRows((rs) =>
      rs.map((r) =>
        r.subjectId === subjectId
          ? { ...r, parts: r.parts.map((p, n) => (n === i ? { ...p, ...patch } : p)) }
          : r,
      ),
    );

  const apply = () =>
    setRows((rs) =>
      rs.map((r) =>
        r.on && !r.entryLocked && !r.parts.some((p) => p.name.trim())
          ? { ...r, max: allMax || r.max, pass: allPass || r.pass }
          : r,
      ),
    );
  const copyFrom = (sourceId: string) => {
    const src = copySources.find((x) => x.classId === sourceId);
    if (!src) return;
    const by = new Map(src.rows.map((r) => [r.subjectId, r]));
    setRows((rs) =>
      rs.map((r) => {
        const s = by.get(r.subjectId);
        if (r.entryLocked) return r;
        return s
          ? { ...r, on: true, max: s.max, pass: s.pass, elective: s.elective, scaleId: s.scaleId }
          : { ...r, on: false };
      }),
    );
  };
  const add = (subjectId: string) => {
    const s = addable.find((x) => x.id === subjectId);
    if (!s || rows.some((r) => r.subjectId === subjectId)) return;
    setRows((rs) => [
      ...rs,
      {
        subjectId: s.id,
        code: s.code,
        name: s.name,
        on: true,
        max: allMax,
        pass: allPass,
        elective: false,
        scaleId: '',
        examOn: null,
        startsAt: null,
        endsAt: null,
        entryLocked: false,
        parts: [],
        children: s.children ?? [],
      },
    ]);
  };
  // a part typed by hand ("Other"): its name box stays open
  const [typed, setTyped] = useState<Set<string>>(new Set());
  const partChoice = (r: EditorRow, p: EditorPart, i: number) => {
    const kid = r.children.find((k) => k.name.trim().toLowerCase() === p.name.trim().toLowerCase());
    if (kid && !typed.has(`${r.subjectId}|${String(i)}`)) return `k:${kid.id}`;
    if (
      (PRESETS as readonly string[]).includes(p.name) &&
      !typed.has(`${r.subjectId}|${String(i)}`)
    )
      return `p:${p.name}`;
    return p.name || typed.has(`${r.subjectId}|${String(i)}`) ? 'other' : '';
  };
  /** a part picked from the list: a sub-subject is entered by its own teacher */
  const pickPart = (r: EditorRow, i: number, value: string) => {
    const key = `${r.subjectId}|${String(i)}`;
    const next = new Set(typed);
    next.delete(key);
    if (value.startsWith('k:')) {
      const kid = r.children.find((k) => k.id === value.slice(2));
      if (kid) changePart(r.subjectId, i, { name: kid.name, subjectId: kid.id });
    } else if (value.startsWith('p:')) changePart(r.subjectId, i, { name: value.slice(2) });
    else if (value === 'other') {
      next.add(key);
      changePart(r.subjectId, i, { name: '' });
    } else changePart(r.subjectId, i, { name: '' });
    setTyped(next);
  };

  const save = async (then?: string) => {
    setError(null);
    const on = rows.filter((r) => r.on);
    for (const r of on) {
      const withParts = r.parts.filter((p) => p.name.trim() && Number(p.max) > 0);
      if (!withParts.length && r.max.trim() === '') {
        setError(t('maxNeeded', { subject: r.name }));
        return;
      }
      if (r.pass.trim() && Number(r.pass) > Number(r.max) && !withParts.length) {
        setError(t('passAbove', { subject: r.name }));
        return;
      }
    }
    const subjects: SubjectInput[] = on.map((r) => {
      const partsMax = r.parts
        .filter((p) => p.name.trim() && Number(p.max) > 0)
        .reduce((a, p) => a + Number(p.max), 0);
      const max = partsMax || Number(r.max);
      return {
        subjectId: r.subjectId,
        maxMarks: max,
        passMarks: max > 0 && r.pass.trim() ? Number(r.pass) : null,
        isElective: r.elective,
        gradeScaleId: r.scaleId || null,
        examOn: r.examOn,
        startsAt: r.startsAt,
        endsAt: r.endsAt,
      };
    });
    const parts: PartsInput[] = on
      .filter((r) => partsKey(r.parts) !== (initialParts.get(r.subjectId) ?? '[]'))
      .map((r) => ({
        subjectId: r.subjectId,
        parts: r.parts
          .filter((p) => p.name.trim() && Number(p.max) > 0)
          .map((p) => ({
            ...(p.id ? { id: p.id } : {}),
            name: p.name.trim(),
            subjectId: p.subjectId || null,
            maxMarks: Number(p.max),
          })),
      }));
    setBusy(true);
    const r = await saveClassSetup(
      examId,
      classId,
      subjects,
      parts,
      set !== (setId ?? '') ? set || null : undefined,
    );
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    // the page again from the server (new parts have their ids), saying it is saved
    leaving.current = true;
    const url = new URL(then ?? window.location.href, window.location.href);
    for (const k of ['error', 'detail', 'new']) url.searchParams.delete(k);
    url.searchParams.set('ok', '1');
    window.location.assign(url.toString());
  };

  const ticked = rows.filter((r) => r.on).length;
  return (
    <div>
      {fromClassList ? (
        <p className="ep-alert ep-alert--info" role="status">
          {t('fromClass', { class: classCode })}
        </p>
      ) : null}
      {locked ? (
        <p className="ep-alert ep-alert--warning" role="status">
          {t('locked')}
        </p>
      ) : null}
      <p className="ep-field__help">{t('subjectsHelp')}</p>
      <div className="ep-xapply">
        <label className="ep-field" htmlFor="xs-allmax">
          <span className="ep-field__label">{t('max')}</span>
          <input
            id="xs-allmax"
            className="ep-input"
            type="number"
            min={0}
            max={1000}
            step="0.5"
            value={allMax}
            onChange={(e) => setAllMax(e.target.value)}
          />
        </label>
        <label className="ep-field" htmlFor="xs-allpass">
          <span className="ep-field__label">{t('pass')}</span>
          <input
            id="xs-allpass"
            className="ep-input"
            type="number"
            min={0}
            max={1000}
            step="0.5"
            value={allPass}
            onChange={(e) => setAllPass(e.target.value)}
          />
        </label>
        <Button type="button" variant="secondary" onClick={apply} disabled={locked}>
          {t('apply')}
        </Button>
        <span className="ep-field__help" style={{ alignSelf: 'center' }}>
          {t('applyAll')}
        </span>
        {copySources.length ? (
          <label className="ep-field" htmlFor="xs-copy" style={{ flex: '0 1 14rem' }}>
            <span className="ep-field__label">{t('copyFrom')}</span>
            <select
              id="xs-copy"
              className="ep-select"
              value=""
              disabled={locked}
              onChange={(e) => copyFrom(e.target.value)}
            >
              <option value="">{t('copyPick')}</option>
              {copySources.map((x) => (
                <option key={x.classId} value={x.classId}>
                  {x.classCode}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <div
        className="ep-table-wrap"
        tabIndex={0}
        role="region"
        aria-label={t('subjectsOf', { class: classCode })}
      >
        <table className="ep-table ep-table--dense ep-xsubj">
          <caption className="ep-sr-only">{t('subjectsOf', { class: classCode })}</caption>
          <thead>
            <tr>
              <th scope="col">{t('include')}</th>
              <th scope="col">{t('subject')}</th>
              <th scope="col">{t('max')}</th>
              <th scope="col">{t('pass')}</th>
              <th scope="col">{t('elective')}</th>
              <th scope="col">{t('scale')}</th>
              <th scope="col">{t('parts')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const named = r.parts.filter((p) => p.name.trim() && Number(p.max) > 0);
              const partsMax = named.reduce((a, p) => a + Number(p.max), 0);
              const off = !r.on;
              const fixed = locked || r.entryLocked;
              return [
                <tr key={r.subjectId} data-off={off ? 'true' : undefined}>
                  <td>
                    <label className="ep-check" htmlFor={`xs-on-${r.subjectId}`}>
                      <input
                        id={`xs-on-${r.subjectId}`}
                        className="ep-check__input"
                        type="checkbox"
                        checked={r.on}
                        disabled={fixed}
                        onChange={(e) => change(r.subjectId, { on: e.target.checked })}
                      />
                      <span className="ep-check__box" aria-hidden="true" />
                      <span className="ep-sr-only">
                        {t('include')} {r.name}
                      </span>
                    </label>
                  </td>
                  <th scope="row">
                    {r.name} <span className="ep-meter__text">{r.code}</span>
                    {r.entryLocked ? (
                      <div className="ep-meter__text">🔒 {t('rowLocked')}</div>
                    ) : null}
                  </th>
                  <td>
                    <input
                      className="ep-input"
                      type="number"
                      min={0}
                      max={1000}
                      step="0.5"
                      aria-label={`${t('max')} · ${r.name}`}
                      value={named.length ? String(partsMax) : r.max}
                      readOnly={named.length > 0}
                      disabled={off || fixed}
                      onChange={(e) => change(r.subjectId, { max: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      className="ep-input"
                      type="number"
                      min={0}
                      max={1000}
                      step="0.5"
                      aria-label={`${t('pass')} · ${r.name}`}
                      value={r.pass}
                      disabled={
                        off || fixed || (!named.length && Number(r.max) === 0 && r.max !== '')
                      }
                      onChange={(e) => change(r.subjectId, { pass: e.target.value })}
                    />
                  </td>
                  <td>
                    <label className="ep-check" htmlFor={`xs-el-${r.subjectId}`}>
                      <input
                        id={`xs-el-${r.subjectId}`}
                        className="ep-check__input"
                        type="checkbox"
                        checked={r.elective}
                        disabled={off || fixed}
                        onChange={(e) => change(r.subjectId, { elective: e.target.checked })}
                      />
                      <span className="ep-check__box" aria-hidden="true" />
                      <span className="ep-sr-only">
                        {t('elective')} · {r.name}
                      </span>
                    </label>
                  </td>
                  <td>
                    <select
                      className="ep-select"
                      aria-label={`${t('scale')} · ${r.name}`}
                      value={r.scaleId}
                      disabled={off || fixed}
                      onChange={(e) => change(r.subjectId, { scaleId: e.target.value })}
                    >
                      <option value="">{t('classScaleOption')}</option>
                      {scales.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.code}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="ep-btn ep-btn--ghost ep-btn--sm"
                      aria-expanded={open === r.subjectId}
                      aria-controls={`xs-parts-${r.subjectId}`}
                      disabled={off || fixed}
                      onClick={() => setOpen(open === r.subjectId ? null : r.subjectId)}
                    >
                      {named.length ? t('partsCount', { n: named.length }) : t('onePiece')}
                    </button>
                  </td>
                </tr>,
                open === r.subjectId ? (
                  <tr key={`${r.subjectId}-parts`}>
                    <td colSpan={7}>
                      <div className="ep-xparts" id={`xs-parts-${r.subjectId}`}>
                        <strong>{t('editParts', { subject: r.name })}</strong>
                        <p className="ep-field__help" style={{ margin: 0 }}>
                          {t('partsHelp')}
                        </p>
                        {r.parts.map((p, i) => (
                          <div key={String(i)} className="ep-xparts__row">
                            <label
                              className="ep-field"
                              htmlFor={`xp-n-${r.subjectId}-${String(i)}`}
                            >
                              <span className="ep-field__label">
                                {t('partName')} {i + 1}
                              </span>
                              <select
                                id={`xp-n-${r.subjectId}-${String(i)}`}
                                className="ep-select"
                                value={partChoice(r, p, i)}
                                onChange={(e) => pickPart(r, i, e.target.value)}
                              >
                                <option value="">{t('partChoose')}</option>
                                {r.children.map((k) => (
                                  <option key={k.id} value={`k:${k.id}`}>
                                    {k.name} ({k.code})
                                  </option>
                                ))}
                                {PRESETS.map((x) => (
                                  <option key={x} value={`p:${x}`}>
                                    {t(x === 'Theory' ? 'partTheory' : 'partPractical')}
                                  </option>
                                ))}
                                <option value="other">{t('partOther')}</option>
                              </select>
                              {partChoice(r, p, i) === 'other' ? (
                                <input
                                  className="ep-input"
                                  aria-label={t('partOtherName', { n: i + 1 })}
                                  maxLength={60}
                                  value={p.name}
                                  onChange={(e) =>
                                    changePart(r.subjectId, i, { name: e.target.value })
                                  }
                                  style={{ marginTop: 'var(--sp-1)' }}
                                />
                              ) : null}
                            </label>
                            <label
                              className="ep-field"
                              htmlFor={`xp-s-${r.subjectId}-${String(i)}`}
                            >
                              <span className="ep-field__label">{t('partBy')}</span>
                              <select
                                id={`xp-s-${r.subjectId}-${String(i)}`}
                                className="ep-select"
                                value={p.subjectId}
                                onChange={(e) =>
                                  changePart(r.subjectId, i, { subjectId: e.target.value })
                                }
                              >
                                <option value="">{t('partItself', { subject: r.name })}</option>
                                {r.children.map((k) => (
                                  <option key={k.id} value={k.id}>
                                    {k.name} ({k.code})
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label
                              className="ep-field"
                              htmlFor={`xp-m-${r.subjectId}-${String(i)}`}
                              style={{ flex: '0 1 7rem' }}
                            >
                              <span className="ep-field__label">{t('partMax')}</span>
                              <input
                                id={`xp-m-${r.subjectId}-${String(i)}`}
                                className="ep-input"
                                type="number"
                                min={0}
                                max={1000}
                                step="0.5"
                                value={p.max}
                                onChange={(e) =>
                                  changePart(r.subjectId, i, { max: e.target.value })
                                }
                              />
                            </label>
                            {p.entered ? (
                              <span className="ep-meter__text">{t('partHasMarks')}</span>
                            ) : (
                              <button
                                type="button"
                                className="ep-btn ep-btn--ghost ep-btn--sm"
                                aria-label={t('removePart', { n: i + 1 })}
                                onClick={() =>
                                  change(r.subjectId, { parts: r.parts.filter((_, n) => n !== i) })
                                }
                              >
                                ✕
                              </button>
                            )}
                          </div>
                        ))}
                        <div>
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() =>
                              change(r.subjectId, {
                                parts: [
                                  ...r.parts,
                                  { name: '', subjectId: '', max: '', entered: 0 },
                                ],
                              })
                            }
                          >
                            {t('addPart')}
                          </Button>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : null,
              ];
            })}
          </tbody>
        </table>
      </div>
      <div className="ep-rp__row" style={{ marginTop: 'var(--sp-3)' }}>
        {addable.length ? (
          <label className="ep-field" htmlFor="xs-add">
            <span className="ep-field__label">{t('addSubject')}</span>
            <select
              id="xs-add"
              className="ep-select"
              value=""
              disabled={locked}
              onChange={(e) => add(e.target.value)}
            >
              <option value="">{t('addPick')}</option>
              {addable
                .filter((x) => !rows.some((r) => r.subjectId === x.id))
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name} ({x.code})
                  </option>
                ))}
            </select>
          </label>
        ) : null}
        <label className="ep-field" htmlFor="xs-set">
          <span className="ep-field__label">{t('progressCard')}</span>
          <select
            id="xs-set"
            className="ep-select"
            value={set}
            onChange={(e) => setSet(e.target.value)}
          >
            <option value="">{t('noSet')}</option>
            {sets.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name} ({x.code})
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="ep-savebar">
        <p className="ep-savebar__status" data-dirty={dirty ? 'true' : 'false'} role="status">
          {error ? (
            <span className="ep-field__error">{error}</span>
          ) : dirty ? (
            t('dirty')
          ) : (
            t('clean')
          )}{' '}
          · {ticked}/{rows.length}
        </p>
        <div className="ep-savebar__actions">
          <Button type="button" onClick={() => void save()} disabled={busy || locked}>
            {busy ? t('saving') : t('save')}
          </Button>
          {next ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => void save(next.href)}
              disabled={busy || locked}
            >
              {next.label}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
