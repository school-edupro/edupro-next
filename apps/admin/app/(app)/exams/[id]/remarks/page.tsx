import { Alert, Badge, Button, Card } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { AutoSubmit } from '@/components/AutoSubmit';
import { Notice } from '@/components/Notice';
import { ExamFrame } from '@/components/exams/ExamFrame';
import { FormSaveBar } from '@/components/exams/FormSaveBar';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { saveRemarksSheet } from '@/lib/exam-sheet-actions';
import type { Exam, ExamProgress } from '@/lib/types';

interface Sheet {
  section: { id: string; code: string };
  locked: boolean;
  categories: Array<{
    id: string;
    code: string;
    name: string;
    subjectName: string | null;
    freeText: boolean;
    may: boolean;
    bank: Array<{ code: string; text: string }>;
  }>;
  rows: Array<{
    studentId: string;
    name: string;
    admissionNo: string;
    rollNo: number | null;
    items: Record<string, { text: string; bankCode: string | null }>;
  }>;
}
interface Register {
  remarkBank: Array<{ code: string; text: string }>;
  rows: Array<{ studentId: string; remark: string | null }>;
}

/**
 * A section's remarks in an exam (docs/design/65, part 7; docs/design/66): the class teacher's general
 * remark first (from the list or their own words), then one remark per category, from the category's
 * list (or the teacher's own words where it allows). The class teacher writes every category, a subject
 * teacher their subject's; the remarks lock closes them. One Save for the whole section.
 */
export default async function ExamRemarksPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ section?: string; ok?: string; error?: string; detail?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const me = await getMe();
  if (!me.permissions.includes('exams.marks.view')) notFound();
  const [t, m, exam, progress, sections] = await Promise.all([
    getTranslations('examHub.entry'),
    getTranslations('examHub.misc'),
    apiFetch<Exam>(`/exams/${id}`).catch((e: unknown) => {
      if (e instanceof ApiError && e.status === 404) notFound();
      throw e;
    }),
    apiFetch<ExamProgress>(`/exams/${id}/progress`).catch(() => null),
    apiFetch<{ data: Array<{ classSectionId: string; code: string }> }>(
      `/exams/${id}/entry/sections`,
    )
      .then((r) => r.data)
      .catch(() => [] as Array<{ classSectionId: string; code: string }>),
  ]);
  const sectionId =
    sections.find((x) => x.classSectionId === sp.section)?.classSectionId ??
    sections[0]?.classSectionId;
  const [sheet, reg] = sectionId
    ? await Promise.all([
        apiFetch<Sheet>(`/exams/${id}/remark-items?classSectionId=${sectionId}`),
        apiFetch<Register>(`/exams/${id}/register?classSectionId=${sectionId}`).catch(() => null),
      ])
    : [null, null];
  const cats = sheet?.categories ?? [];
  const open = !!sheet && !sheet.locked;
  const writable = cats.filter((k) => k.may);
  // the general remark: the class teacher's (the remark entry right)
  const general = reg && me.permissions.includes('exams.remark.enter') && open;
  const remarkOf = new Map((reg?.rows ?? []).map((r) => [r.studentId, r.remark ?? '']));
  const back = `/exams/${id}/remarks${sectionId ? `?section=${sectionId}` : ''}`;
  return (
    <>
      <ExamFrame
        exam={exam}
        stage={progress?.stage ?? null}
        current="remarks"
        canManage={me.permissions.includes('exams.master.manage')}
        canLock={me.permissions.includes('exams.lock.manage')}
      />
      <Notice params={sp} />
      <Card style={{ marginBottom: 'var(--sp-4)' }}>
        <form method="get" className="ep-rp__row" aria-label={t('sheet')}>
          <AutoSubmit />
          <label className="ep-field" htmlFor="rm-section">
            <span className="ep-field__label">{t('section')}</span>
            <select id="rm-section" className="ep-select" name="section" defaultValue={sectionId}>
              {sections.map((x) => (
                <option key={x.classSectionId} value={x.classSectionId}>
                  {x.code}
                </option>
              ))}
            </select>
          </label>
          <noscript>
            <Button type="submit" variant="secondary">
              {t('sheet')}
            </Button>
          </noscript>
        </form>
        <p className="ep-field__help">{t('generalHelp')}</p>
        <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/exams/remarks">
          {t('remarkSetup')}
        </a>
      </Card>
      {sheet ? (
        <Card
          elevated
          title={sheet.section.code}
          actions={
            sheet.locked ? (
              <Badge tone="warning">{t('locked')}</Badge>
            ) : (
              <Badge tone="neutral">{t('students', { n: sheet.rows.length })}</Badge>
            )
          }
        >
          {reg && reg.remarkBank.length === 0 ? (
            <Alert tone="warning">{t('noGeneral', { section: sheet.section.code })}</Alert>
          ) : null}
          <datalist id="rb-general">
            {(reg?.remarkBank ?? []).map((b) => (
              <option key={b.code} value={b.text} />
            ))}
          </datalist>
          {cats.map((k) =>
            k.freeText ? (
              <datalist key={k.id} id={`rb-${k.id}`}>
                {k.bank.map((b) => (
                  <option key={b.code} value={b.text} />
                ))}
              </datalist>
            ) : null,
          )}
          <form action={saveRemarksSheet}>
            <input type="hidden" name="examId" value={exam.id} />
            <input type="hidden" name="classSectionId" value={sheet.section.id} />
            <input type="hidden" name="back" value={back} />
            {writable.map((k) => (
              <input key={k.id} type="hidden" name="category" value={k.id} />
            ))}
            <div className="ep-table-wrap" tabIndex={0} role="region" aria-label={t('sheet')}>
              <table className="ep-table ep-table--dense">
                <caption className="ep-sr-only">{sheet.section.code}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('roll')}</th>
                    <th scope="col">{t('student')}</th>
                    {reg ? <th scope="col">{t('generalRemark')}</th> : null}
                    {cats.map((k) => (
                      <th key={k.id} scope="col">
                        {k.name}
                        {k.subjectName ? (
                          <span className="ep-kicker" style={{ display: 'block' }}>
                            {k.subjectName}
                          </span>
                        ) : null}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sheet.rows.map((r) => (
                    <tr key={r.studentId}>
                      <td>{r.rollNo ?? ''}</td>
                      <th scope="row">
                        <input type="hidden" name="studentId" value={r.studentId} />
                        {r.name}
                        <span className="ep-kicker" style={{ display: 'block' }}>
                          {r.admissionNo}
                        </span>
                      </th>
                      {reg ? (
                        <td style={{ minWidth: '16rem' }}>
                          <input
                            type="hidden"
                            name={`g0-${r.studentId}`}
                            value={remarkOf.get(r.studentId) ?? ''}
                          />
                          <input
                            className="ep-input"
                            name={general ? `g-${r.studentId}` : undefined}
                            list="rb-general"
                            aria-label={`${t('generalRemark')} · ${r.name}`}
                            maxLength={600}
                            defaultValue={remarkOf.get(r.studentId) ?? ''}
                            disabled={!general}
                          />
                        </td>
                      ) : null}
                      {cats.map((k) => {
                        const v = r.items[k.id]?.text ?? '';
                        const name = `r-${r.studentId}-${k.id}`;
                        const off = !open || !k.may;
                        const label = `${k.name} · ${r.name}`;
                        return (
                          <td key={k.id} style={{ minWidth: '14rem' }}>
                            {k.freeText ? (
                              <input
                                className="ep-input"
                                name={name}
                                list={`rb-${k.id}`}
                                aria-label={label}
                                maxLength={600}
                                defaultValue={v}
                                disabled={off}
                              />
                            ) : (
                              <select
                                className="ep-select"
                                name={name}
                                aria-label={label}
                                defaultValue={v}
                                disabled={off}
                              >
                                <option value="">-</option>
                                {k.bank.map((b) => (
                                  <option key={b.code} value={b.text}>
                                    {b.text}
                                  </option>
                                ))}
                              </select>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {open && (general || writable.length) ? (
              <FormSaveBar>
                <Button type="submit">{t('save')}</Button>
              </FormSaveBar>
            ) : (
              <p className="ep-field__help">
                {sheet.locked ? m('remarksLocked') : m('remarksViewOnly')}
              </p>
            )}
          </form>
        </Card>
      ) : null}
    </>
  );
}
