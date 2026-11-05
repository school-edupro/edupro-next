'use client';
import { Badge, Button, Drawer } from '@edupro/ui';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { ExcelUpload } from '@/components/exams/ExcelUpload';
import {
  bulkHold,
  lineStudents,
  uploadHolds,
  type BulkHoldResult,
  type LineStudent,
} from '@/lib/report-card-actions';

export interface HoldClass {
  id: string;
  code: string;
  sections: Array<{ id: string; code: string }>;
}
export interface OtherCard {
  id: string;
  termCode: string;
  name: string;
}

/**
 * The "Hold cards" window of the Publish tab (docs/design/75): pick the students by class and section
 * (the old Report Card Hide page: a tick each, a tick-all) or upload an Excel of admission numbers; one
 * reason for those held together (an Excel row may carry its own), and, when wanted, the same hold in
 * the year's other published cards.
 */
export function HoldWindow({
  releaseId,
  classes,
  others,
  open,
  onClose,
  onDone,
}: {
  releaseId: string;
  classes: HoldClass[];
  others: OtherCard[];
  open: boolean;
  onClose: () => void;
  /** after a save: the held list reloads */
  onDone: () => void;
}) {
  const t = useTranslations('rcHolds');
  const router = useRouter();
  const [way, setWay] = useState<'pick' | 'excel'>('pick');
  const [classId, setClassId] = useState(classes[0]?.id ?? '');
  const [sectionId, setSectionId] = useState('');
  const [list, setList] = useState<LineStudent[] | null>(null);
  const [ticked, setTicked] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [also, setAlso] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger' | 'info'; text: string } | null>(
    null,
  );
  const [outcome, setOutcome] = useState<BulkHoldResult | null>(null);
  const [reload, setReload] = useState(0);
  const [pending, start] = useTransition();
  const klass = classes.find((k) => k.id === classId);

  useEffect(() => {
    if (!open || !classId) return;
    let live = true;
    setList(null);
    void lineStudents(releaseId, sectionId ? `s:${sectionId}` : `c:${classId}`, 'active').then(
      (r) => {
        if (!live) return;
        if (r.ok) {
          setList(r.data);
          setTicked((x) => x.filter((id) => r.data.some((s) => s.studentId === id)));
        } else setMsg({ tone: 'danger', text: r.error });
      },
    );
    return () => {
      live = false;
    };
  }, [open, releaseId, classId, sectionId, reload]);

  const free = (list ?? []).filter((s) => !s.heldReason);
  const allTicked = free.length > 0 && free.every((s) => ticked.includes(s.studentId));
  const toggle = (id: string, on: boolean) =>
    setTicked((x) => (on ? [...new Set([...x, id])] : x.filter((y) => y !== id)));
  const short = reason.trim().length < 3;

  const done = (r: BulkHoldResult, held: boolean) => {
    setOutcome(r);
    setMsg({
      tone: 'success',
      text: held
        ? t('heldDone', { n: r.held, also: r.alsoHeld })
        : t('shownDone', { n: r.lifted, told: r.notified }),
    });
    setTicked([]);
    setReload((n) => n + 1);
    onDone();
    router.refresh();
  };
  const hold = () =>
    start(async () => {
      setMsg(null);
      setOutcome(null);
      const r = await bulkHold(releaseId, {
        studentIds: ticked,
        held: true,
        reason,
        alsoReleaseIds: also,
      });
      if (r.ok) done(r.data, true);
      else setMsg({ tone: 'danger', text: r.error });
    });
  const showAgain = (id: string) =>
    start(async () => {
      setMsg(null);
      setOutcome(null);
      const r = await bulkHold(releaseId, { studentIds: [id], held: false });
      if (r.ok) done(r.data, false);
      else setMsg({ tone: 'danger', text: r.error });
    });

  return (
    <Drawer
      open={open}
      title={t('windowTitle')}
      onClose={onClose}
      width="lg"
      footer={
        way === 'pick' ? (
          <div className="ep-form-actions" style={{ margin: 0 }}>
            <Button
              loading={pending}
              disabled={!ticked.length || short}
              onClick={hold}
              title={short ? t('reasonFirst') : undefined}
            >
              {t('holdN', { n: ticked.length })}
            </Button>
            <Button variant="ghost" onClick={onClose}>
              {t('close')}
            </Button>
          </div>
        ) : (
          <div className="ep-form-actions" style={{ margin: 0 }}>
            <Button variant="ghost" onClick={onClose}>
              {t('close')}
            </Button>
          </div>
        )
      }
    >
      <div className="ep-xchips" role="group" aria-label={t('wayGroup')}>
        {(['pick', 'excel'] as const).map((k) => (
          <button
            key={k}
            type="button"
            className={`ep-btn ep-btn--sm ${way === k ? 'ep-btn--primary' : 'ep-btn--secondary'}`}
            aria-pressed={way === k}
            onClick={() => {
              setWay(k);
              setMsg(null);
              setOutcome(null);
            }}
          >
            {t(`way_${k}`)}
          </button>
        ))}
      </div>

      <label className="ep-field" style={{ marginTop: 'var(--sp-3)' }}>
        <span className="ep-field__label">
          {way === 'pick' ? t('reasonLabel') : t('reasonExcelLabel')}
        </span>
        <textarea
          className="ep-input"
          rows={2}
          maxLength={300}
          value={reason}
          placeholder={t('reasonPlaceholder')}
          onChange={(e) => setReason(e.target.value)}
        />
        <span className="ep-field__help">{t('reasonHelp')}</span>
      </label>
      {others.length ? (
        <fieldset className="ep-field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="ep-field__label">{t('alsoLegend')}</legend>
          {others.map((o) => (
            <label key={o.id} className="ep-check" style={{ display: 'flex' }}>
              <input
                className="ep-check__input"
                type="checkbox"
                checked={also.includes(o.id)}
                onChange={(e) =>
                  setAlso((x) => (e.target.checked ? [...x, o.id] : x.filter((y) => y !== o.id)))
                }
              />
              <span className="ep-check__box" aria-hidden="true" /> {o.termCode} · {o.name}
            </label>
          ))}
          <span className="ep-field__help">{t('alsoHelp')}</span>
        </fieldset>
      ) : null}

      {way === 'pick' ? (
        <>
          <div className="ep-rp__row" style={{ marginTop: 'var(--sp-3)' }}>
            <label className="ep-field">
              <span className="ep-field__label">{t('class')}</span>
              <select
                className="ep-select"
                value={classId}
                onChange={(e) => {
                  setClassId(e.target.value);
                  setSectionId('');
                }}
              >
                {classes.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.code}
                  </option>
                ))}
              </select>
            </label>
            <label className="ep-field">
              <span className="ep-field__label">{t('section')}</span>
              <select
                className="ep-select"
                value={sectionId}
                onChange={(e) => setSectionId(e.target.value)}
              >
                <option value="">{t('allSections')}</option>
                {(klass?.sections ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {list === null ? (
            <p className="ep-field__help">{t('loading')}</p>
          ) : !list.length ? (
            <p className="ep-field__help">{t('noStudents')}</p>
          ) : (
            <div
              className="ep-table-wrap"
              tabIndex={0}
              role="region"
              aria-label={t('pickCaption')}
              style={{ maxHeight: '50vh' }}
            >
              <table className="ep-table ep-table--dense">
                <caption className="ep-sr-only">{t('pickCaption')}</caption>
                <thead>
                  <tr>
                    <th scope="col">
                      <label className="ep-check">
                        <input
                          className="ep-check__input"
                          type="checkbox"
                          checked={allTicked}
                          disabled={!free.length}
                          aria-label={t('tickAll')}
                          onChange={(e) =>
                            setTicked(e.target.checked ? free.map((s) => s.studentId) : [])
                          }
                        />
                        <span className="ep-check__box" aria-hidden="true" />
                      </label>
                    </th>
                    <th scope="col">{t('roll')}</th>
                    <th scope="col">{t('admissionNo')}</th>
                    <th scope="col">{t('student')}</th>
                    {sectionId ? null : <th scope="col">{t('section')}</th>}
                    <th scope="col">{t('state')}</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((s) => (
                    <tr key={s.studentId}>
                      <td>
                        <label className="ep-check">
                          <input
                            className="ep-check__input"
                            type="checkbox"
                            disabled={Boolean(s.heldReason)}
                            checked={Boolean(s.heldReason) || ticked.includes(s.studentId)}
                            aria-label={t('tickOne', { name: s.name })}
                            onChange={(e) => toggle(s.studentId, e.target.checked)}
                          />
                          <span className="ep-check__box" aria-hidden="true" />
                        </label>
                      </td>
                      <td>{s.rollNo ?? ''}</td>
                      <td>{s.admissionNo}</td>
                      <td>{s.name}</td>
                      {sectionId ? null : <td>{s.section}</td>}
                      <td>
                        {s.heldReason ? (
                          <span
                            style={{ display: 'inline-flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}
                          >
                            <Badge tone="warning">{t('heldAs', { reason: s.heldReason })}</Badge>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={pending}
                              onClick={() => showAgain(s.studentId)}
                              aria-label={t('showAgainOne', { name: s.name })}
                            >
                              {t('showAgain')}
                            </Button>
                          </span>
                        ) : s.feeDue ? (
                          <Badge tone="neutral">{t('feeDue')}</Badge>
                        ) : (
                          <Badge tone="success">{t('shown')}</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <div style={{ marginTop: 'var(--sp-3)' }}>
          <ol className="ep-field__help" style={{ paddingLeft: 'var(--sp-4)' }}>
            <li>
              <a
                className="ep-btn ep-btn--secondary ep-btn--sm"
                href={`/api/report-card-holds?releaseId=${releaseId}&kind=template`}
              >
                {t('downloadFormat')}
              </a>
            </li>
            <li>{t('excelStep2')}</li>
            <li>{t('excelStep3')}</li>
          </ol>
          <ExcelUpload
            label={t('uploadLabel')}
            partial
            upload={(file, apply) => uploadHolds(releaseId, reason, also, file, apply)}
            saveLabel={(n) => t('holdN', { n })}
            savedText={(n) => t('heldDone', { n, also: 0 })}
            onSaved={() => {
              setReload((n) => n + 1);
              onDone();
            }}
          />
        </div>
      )}

      {msg ? (
        <div
          className={`ep-alert ep-alert--${msg.tone}`}
          role={msg.tone === 'danger' ? 'alert' : 'status'}
          style={{ marginTop: 'var(--sp-3)' }}
        >
          {msg.text}
        </div>
      ) : null}
      {outcome && (outcome.refused.length || outcome.unchanged.length) ? (
        <ul className="ep-field__help" style={{ marginTop: 'var(--sp-2)' }}>
          {outcome.unchanged.map((x) => (
            <li key={`u${x.studentId}`}>{t('unchanged', { name: x.name, section: x.section })}</li>
          ))}
          {outcome.refused.map((x) => (
            <li key={`r${x.key}`}>
              {x.name ?? x.key}: {x.error}
            </li>
          ))}
        </ul>
      ) : null}
    </Drawer>
  );
}
