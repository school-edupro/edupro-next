'use client';
import { Dialog } from '@edupro/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { generateLine, lineStudents, type LineStudent } from '@/lib/report-card-actions';
import { CARD_RANGES, CARD_STATUSES } from '@/lib/report-card-release';
import { CardPreview, type PreviewStudent } from './CardPreview';

export interface CardsLine {
  key: string;
  label: string;
  design: string | null;
  classes: Array<{ id: string; code: string; sections: Array<{ id: string; code: string }> }>;
}

/** positions in roll order, taken in each section (the API cuts the same way) */
const SLICE: Record<(typeof CARD_RANGES)[number], [number, number]> = {
  first10: [0, 10],
  '11-20': [10, 20],
  '21-30': [20, 30],
  '31-40': [30, 40],
  above40: [40, Infinity],
  '1-2': [0, 2],
  all: [0, Infinity],
};
const admOf = (v: string) => v.split(' — ')[0]!.trim();

/**
 * The Cards tab as the legacy Exam Report Card (docs/design/65, 1 Nov 2026): one line per card design;
 * on a line pick the class (a section, or every section), the students (a roll-order range or one
 * admission number, by status) and Generate Report Card (made in the background, then downloaded) or the
 * eye (the cards at once in the side panel, with holds). One PDF is made at a time.
 */
export function CardsTable({
  releaseId,
  term,
  lines,
  canManage,
}: {
  releaseId: string;
  /** the release's term: the code in the select (legacy "TERM1"), the name as its tooltip */
  term: { code: string; name: string };
  lines: CardsLine[];
  canManage: boolean;
}) {
  const t = useTranslations('rcRelease');
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewStudent[] | null>(null);
  return (
    <>
      <div className="ep-table-wrap" tabIndex={0} role="region" aria-label={t('linesCaption')}>
        <table className="ep-table ep-rcw-lines">
          <caption className="ep-sr-only">{t('linesCaption')}</caption>
          <colgroup>
            <col style={{ width: '4%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '13%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '13%' }} />
            <col style={{ width: '29%' }} />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">{t('srNo')}</th>
              <th scope="col">{t('description')}</th>
              <th scope="col">{t('class')}</th>
              <th scope="col">{t('examType')}</th>
              <th scope="col">{t('rollNo')}</th>
              <th scope="col">{t('studentStatus')}</th>
              <th scope="col">{t('searchAdmission')}</th>
              <th scope="col">{t('generateHead')}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, i) => (
              <Line
                key={line.key}
                n={i + 1}
                line={line}
                releaseId={releaseId}
                term={term}
                canManage={canManage}
                busy={busy}
                setBusy={setBusy}
                onPreview={setPreview}
              />
            ))}
          </tbody>
        </table>
      </div>
      <CardPreview
        releaseId={releaseId}
        students={preview ?? []}
        open={preview !== null}
        onClose={() => setPreview(null)}
        canHold={canManage}
      />
    </>
  );
}

function Line({
  n,
  line,
  releaseId,
  term,
  canManage,
  busy,
  setBusy,
  onPreview,
}: {
  n: number;
  line: CardsLine;
  releaseId: string;
  term: { code: string; name: string };
  canManage: boolean;
  busy: string | null;
  setBusy: (k: string | null) => void;
  onPreview: (s: PreviewStudent[]) => void;
}) {
  const t = useTranslations('rcRelease');
  const [place, setPlace] = useState('');
  const [range, setRange] = useState('');
  const [status, setStatus] = useState<string>('active');
  const [adm, setAdm] = useState('');
  const [students, setStudents] = useState<LineStudent[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [job, setJob] = useState<{ seconds: number } | null>(null);
  const [msg, setMsg] = useState<{ tone: 'error' | 'info' | 'success'; text: string } | null>(null);
  const [askAll, setAskAll] = useState(false);
  const stop = useRef(false);
  const id = `rcw-line-${String(n)}`;
  useEffect(() => {
    if (!place) {
      setStudents(null);
      return;
    }
    let gone = false;
    setLoading(true);
    void lineStudents(releaseId, place, status).then((r) => {
      if (gone) return;
      setLoading(false);
      if (r.ok) setStudents(r.data);
      else setMsg({ tone: 'error', text: r.error });
    });
    return () => {
      gone = true;
    };
  }, [releaseId, place, status]);
  useEffect(
    () => () => {
      stop.current = true;
    },
    [],
  );
  const whole = place.startsWith('c:');
  const chosen = (): LineStudent[] => {
    const list = students ?? [];
    const one = admOf(adm).toLowerCase();
    if (one) return list.filter((x) => x.admissionNo.toLowerCase() === one);
    const [from, to] = SLICE[(range || 'all') as keyof typeof SLICE];
    const bySection = new Map<string, LineStudent[]>();
    for (const x of list) bySection.set(x.section, [...(bySection.get(x.section) ?? []), x]);
    return [...bySection.values()].flatMap((xs) => xs.slice(from, to));
  };
  const check = (): boolean => {
    if (!place) setMsg({ tone: 'error', text: t('needClass') });
    else if (!range && !admOf(adm)) setMsg({ tone: 'error', text: t('needStudents') });
    else return true;
    return false;
  };
  const view = () => {
    if (!place) {
      setMsg({ tone: 'error', text: t('needClass') });
      return;
    }
    const xs = chosen();
    if (!xs.length) {
      setMsg({ tone: 'error', text: t('noStudents') });
      return;
    }
    setMsg(null);
    onPreview(xs.map((x) => ({ id: x.studentId, name: x.name, heldReason: x.heldReason })));
  };
  const generate = async () => {
    setAskAll(false);
    setBusy(line.key);
    setMsg(null);
    setJob({ seconds: 0 });
    const r = await generateLine(releaseId, { place, range, status, admissionNo: admOf(adm) });
    if (!r.ok) {
      setBusy(null);
      setJob(null);
      setMsg({ tone: 'error', text: r.error });
      return;
    }
    const started = Date.now();
    const tick = async (): Promise<void> => {
      if (stop.current) return;
      const seconds = Math.round((Date.now() - started) / 1000);
      setJob({ seconds });
      try {
        const res = await fetch(`/reports/exports/${r.data.exportId}/status`, {
          cache: 'no-store',
        });
        const s = (await res.json()) as { status?: string; ready?: boolean; error?: string | null };
        if (s.ready) {
          setBusy(null);
          setJob(null);
          setMsg({ tone: 'success', text: t('downloaded', { n: r.data.students }) });
          window.location.assign(`/reports/exports/${r.data.exportId}/download?save=1`);
          return;
        }
        if (s.status === 'failed') {
          setBusy(null);
          setJob(null);
          setMsg({ tone: 'error', text: t('genFailed', { error: s.error ?? '' }) });
          return;
        }
      } catch {
        // transient: try again
      }
      if (seconds >= 90) {
        setBusy(null);
        setJob(null);
        setMsg({ tone: 'info', text: t('genStuck') });
        return;
      }
      setTimeout(() => void tick(), 2000);
    };
    void tick();
  };
  const onGenerate = () => {
    if (!check()) return;
    if (whole && !admOf(adm) && range === 'all') setAskAll(true);
    else void generate();
  };
  const wholeClass = line.classes.find((k) => `c:${k.id}` === place);
  return (
    <tr>
      <td>{n}.</td>
      <td>
        <strong>{t('lineLabel', { classes: line.label })}</strong>
        <span className="ep-mr-col__desc">{line.design ?? t('noDesignShort')}</span>
      </td>
      <td>
        <select
          className="ep-select"
          aria-label={t('classOf', { line: line.label })}
          value={place}
          onChange={(e) => {
            setPlace(e.target.value);
            setAdm('');
            setMsg(null);
          }}
        >
          <option value="">{t('selectOption')}</option>
          {line.classes.map((k) => [
            k.sections.length > 1 ? (
              <option key={`c${k.id}`} value={`c:${k.id}`}>
                {t('allSections', { cls: k.code })}
              </option>
            ) : null,
            ...k.sections.map((s) => (
              <option key={s.id} value={`s:${s.id}`}>
                {s.code}
              </option>
            )),
          ])}
        </select>
      </td>
      <td>
        <select
          className="ep-select"
          aria-label={t('examTypeOf', { line: line.label })}
          disabled={!place}
          defaultValue="this"
          title={term.name}
        >
          <option value="this">{term.code}</option>
        </select>
      </td>
      <td>
        <select
          className="ep-select"
          aria-label={t('rollNoOf', { line: line.label })}
          value={range}
          onChange={(e) => {
            setRange(e.target.value);
            setMsg(null);
          }}
        >
          <option value="">{t('select')}</option>
          {CARD_RANGES.map((r) => (
            <option key={r} value={r}>
              {t(`range_${r}`)}
            </option>
          ))}
        </select>
      </td>
      <td>
        <select
          className="ep-select"
          aria-label={t('studentStatusOf', { line: line.label })}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          {CARD_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`stu_${s}`)}
            </option>
          ))}
        </select>
      </td>
      <td>
        <input
          className="ep-input"
          list={`${id}-adm`}
          autoComplete="off"
          placeholder={t('admissionNo')}
          aria-label={t('admissionOf', { line: line.label })}
          disabled={!place}
          value={adm}
          onChange={(e) => {
            setAdm(e.target.value);
            setMsg(null);
          }}
        />
        <datalist id={`${id}-adm`}>
          {(students ?? []).map((x) => (
            <option key={x.studentId} value={`${x.admissionNo} — ${x.name}`} />
          ))}
        </datalist>
        {loading ? <span className="ep-mr-col__desc">{t('loadingStudents')}</span> : null}
        {students && !loading ? (
          <span className="ep-mr-col__desc">{t('studentsFound', { n: students.length })}</span>
        ) : null}
      </td>
      <td>
        <div className="ep-rcw-gen-wrap">
          {canManage ? (
            <button
              type="button"
              className="ep-rcw-gen"
              disabled={busy !== null}
              aria-busy={busy === line.key}
              onClick={onGenerate}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path
                  d="M6 2h9l5 5v15H6V2Zm8 1.5V8h4.5M8.5 13h1.8a1.6 1.6 0 0 1 0 3.2H8.5V13Zm0 3.2V18m5-5v5h1.2a2.5 2.5 0 0 0 0-5h-1.2Zm5 0h-2v5m0-2.6h1.7"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                />
              </svg>
              <span>
                {busy === line.key && job ? t('making', { s: job.seconds }) : t('generate')}
              </span>
            </button>
          ) : null}
          <button
            type="button"
            className="ep-rcw-eye"
            onClick={view}
            aria-label={t('viewOf', { line: line.label })}
            title={t('viewOf', { line: line.label })}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path
                d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
                fill="currentColor"
              />
            </svg>
          </button>
        </div>
        {msg ? (
          <p
            className={`ep-rcw-line-msg ep-rcw-line-msg--${msg.tone}`}
            role={msg.tone === 'error' ? 'alert' : 'status'}
          >
            {msg.text}
          </p>
        ) : null}
        {askAll ? (
          <Dialog
            open
            size="sm"
            title={t('allTitle', { cls: wholeClass?.code ?? '' })}
            onClose={() => setAskAll(false)}
            primary={{ label: t('allConfirm'), onClick: () => void generate() }}
          >
            <p style={{ margin: 0 }}>
              {t('allBody', {
                n: students?.length ?? 0,
                sections: wholeClass?.sections.length ?? 0,
              })}
            </p>
          </Dialog>
        ) : null}
      </td>
    </tr>
  );
}
