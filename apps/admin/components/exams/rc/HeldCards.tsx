'use client';
import { Badge, Button, Dialog } from '@edupro/ui';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { ViewDownload } from '@/components/admissions/ViewDownload';
import { bulkHold, releaseHolds, type HeldRow } from '@/lib/report-card-actions';
import { HoldWindow, type HoldClass, type OtherCard } from './HoldWindow';

/**
 * The held cards of a release on its Publish tab (docs/design/75): filters by class, section and words
 * (name, admission no, reason), the list with who held each and when, Show again (one or the ticked),
 * Excel and PDF of the list, and Hold cards… (the window). Cards the fee rule withholds are only counted:
 * the rule decides them. A class teacher sees their section's holds, read only.
 */
export function HeldCards({
  releaseId,
  published,
  classes,
  others,
  canManage,
  startClassId,
}: {
  releaseId: string;
  /** some class is published: showing a card again tells its family */
  published: boolean;
  classes: HoldClass[];
  others: OtherCard[];
  canManage: boolean;
  /** the class picked from the Held column of the class table */
  startClassId?: string;
}) {
  const t = useTranslations('rcHolds');
  const router = useRouter();
  const [classId, setClassId] = useState(
    startClassId && classes.some((k) => k.id === startClassId) ? startClassId : '',
  );
  const [sectionId, setSectionId] = useState('');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<HeldRow[] | null>(null);
  const [fee, setFee] = useState<number | null>(null);
  const [ticked, setTicked] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState<HeldRow[] | null>(null);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [reload, setReload] = useState(0);
  const [pending, start] = useTransition();
  const klass = classes.find((k) => k.id === classId);

  useEffect(() => {
    let live = true;
    const h = setTimeout(
      () => {
        void releaseHolds(releaseId, {
          ...(sectionId ? { classSectionId: sectionId } : classId ? { classId } : {}),
          q,
        }).then((r) => {
          if (!live) return;
          if (r.ok) {
            setRows(r.data.data);
            setFee(r.data.feeWithheld);
            setTicked((x) => x.filter((id) => r.data.data.some((d) => d.studentId === id)));
          } else setMsg({ tone: 'danger', text: r.error });
        });
      },
      q ? 300 : 0,
    );
    return () => {
      live = false;
      clearTimeout(h);
    };
  }, [releaseId, classId, sectionId, q, reload]);

  const fileHref = (format: 'xlsx' | 'pdf') => {
    const p = new URLSearchParams({ releaseId, format });
    if (sectionId) p.set('classSectionId', sectionId);
    else if (classId) p.set('classId', classId);
    if (q.trim()) p.set('q', q.trim());
    return `/api/report-card-holds?${p.toString()}`;
  };
  const list = rows ?? [];
  const allTicked = list.length > 0 && list.every((r) => ticked.includes(r.studentId));
  const when = (iso: string) =>
    new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(new Date(iso));

  const showAgain = (who: HeldRow[]) =>
    start(async () => {
      setMsg(null);
      const r = await bulkHold(releaseId, {
        studentIds: who.map((x) => x.studentId),
        held: false,
      });
      setConfirm(null);
      if (!r.ok) {
        setMsg({ tone: 'danger', text: r.error });
        return;
      }
      setMsg({
        tone: 'success',
        text: t('shownDone', { n: r.data.lifted, told: r.data.notified }),
      });
      setTicked([]);
      setReload((n) => n + 1);
      router.refresh();
    });

  return (
    <section aria-labelledby="held-cards-title" id="held">
      <div className="ep-rcw-toolbar">
        <h2 id="held-cards-title">{t('title', { n: list.length })}</h2>
        <span style={{ flex: 1 }} />
        <a className="ep-btn ep-btn--secondary ep-btn--sm" href={fileHref('xlsx')}>
          {t('excel')}
        </a>
        <span>
          {t('pdf')} <ViewDownload href={fileHref('pdf')} what={t('pdfWhat')} />
        </span>
        {canManage ? (
          <Button size="sm" onClick={() => setOpen(true)}>
            {t('holdCards')}
          </Button>
        ) : null}
      </div>
      <p className="ep-field__help" style={{ marginTop: 0 }}>
        {canManage ? t('help') : t('helpReadOnly')}
      </p>
      <div className="ep-rp__row">
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
            <option value="">{t('allClasses')}</option>
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
            disabled={!klass}
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
        <label className="ep-field">
          <span className="ep-field__label">{t('search')}</span>
          <input
            className="ep-input"
            type="search"
            value={q}
            maxLength={60}
            placeholder={t('searchPlaceholder')}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
      </div>
      {fee !== null ? (
        <p className="ep-field__help">
          <Badge tone="neutral">{t('feeWithheld', { n: fee })}</Badge> {t('feeWithheldHelp')}
        </p>
      ) : null}
      {msg ? (
        <div
          className={`ep-alert ep-alert--${msg.tone}`}
          role={msg.tone === 'danger' ? 'alert' : 'status'}
        >
          {msg.text}
        </div>
      ) : null}
      {canManage && ticked.length ? (
        <div className="ep-form-actions" style={{ marginTop: 0 }}>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setConfirm(list.filter((r) => ticked.includes(r.studentId)))}
          >
            {t('showAgainN', { n: ticked.length })}
          </Button>
        </div>
      ) : null}
      {rows === null ? (
        <p className="ep-field__help">{t('loading')}</p>
      ) : !list.length ? (
        <p className="ep-field__help">{t('none')}</p>
      ) : (
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-label={t('caption')}>
          <table className="ep-table ep-table--dense">
            <caption className="ep-sr-only">{t('caption')}</caption>
            <thead>
              <tr>
                {canManage ? (
                  <th scope="col">
                    <label className="ep-check">
                      <input
                        className="ep-check__input"
                        type="checkbox"
                        checked={allTicked}
                        aria-label={t('tickAllHeld')}
                        onChange={(e) =>
                          setTicked(e.target.checked ? list.map((r) => r.studentId) : [])
                        }
                      />
                      <span className="ep-check__box" aria-hidden="true" />
                    </label>
                  </th>
                ) : null}
                <th scope="col">{t('admissionNo')}</th>
                <th scope="col">{t('student')}</th>
                <th scope="col">{t('section')}</th>
                <th scope="col">{t('reason')}</th>
                <th scope="col">{t('heldBy')}</th>
                {canManage ? (
                  <th scope="col">
                    <span className="ep-sr-only">{t('actions')}</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.studentId}>
                  {canManage ? (
                    <td>
                      <label className="ep-check">
                        <input
                          className="ep-check__input"
                          type="checkbox"
                          checked={ticked.includes(r.studentId)}
                          aria-label={t('tickOne', { name: r.name })}
                          onChange={(e) =>
                            setTicked((x) =>
                              e.target.checked
                                ? [...x, r.studentId]
                                : x.filter((y) => y !== r.studentId),
                            )
                          }
                        />
                        <span className="ep-check__box" aria-hidden="true" />
                      </label>
                    </td>
                  ) : null}
                  <td>{r.admissionNo}</td>
                  <td>{r.name}</td>
                  <td>{r.section}</td>
                  <td>{r.reason}</td>
                  <td>
                    {r.heldBy ?? '—'}
                    <span className="ep-mr-col__desc">{when(r.heldAt)}</span>
                  </td>
                  {canManage ? (
                    <td>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setConfirm([r])}
                        aria-label={t('showAgainOne', { name: r.name })}
                      >
                        {t('showAgain')}
                      </Button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Dialog
        open={confirm !== null}
        title={t('confirmTitle', { n: confirm?.length ?? 0 })}
        onClose={() => setConfirm(null)}
        primary={{
          label: t('showAgain'),
          onClick: () => confirm && showAgain(confirm),
          loading: pending,
        }}
        secondaryLabel={t('cancel')}
      >
        <p style={{ marginTop: 0 }}>
          {confirm?.length === 1
            ? t('confirmOne', { name: confirm[0]!.name })
            : t('confirmMany', { n: confirm?.length ?? 0 })}{' '}
          {published ? t('confirmTold') : t('confirmNotYet')}
        </p>
      </Dialog>
      {canManage ? (
        <HoldWindow
          releaseId={releaseId}
          classes={classes}
          others={others}
          open={open}
          onClose={() => setOpen(false)}
          onDone={() => setReload((n) => n + 1)}
        />
      ) : null}
    </section>
  );
}
