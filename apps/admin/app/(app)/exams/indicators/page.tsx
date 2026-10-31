import { Badge, Breadcrumbs, Button, Card, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { IndicatorSetEditor } from '@/components/exams/IndicatorSetEditor';
import { MasterExport } from '@/components/MasterExport';
import { ExamSetupNav } from '@/components/exams/ExamSetupNav';
import { Notice } from '@/components/Notice';
import { installHpcCard, installHpcSet, saveSetMapping, type SetInput } from '@/lib/hpc-actions';
import { apiFetch, getMe } from '@/lib/api';
import type { ClassRow, Page } from '@/lib/types';

interface SetRow {
  id: string;
  code: string;
  name: string;
  grades: string[];
  status: string;
  kind: 'indicators' | 'hpc';
  levelWords: Record<string, string>;
  /** the classes the set is for (docs/design/66) */
  classIds: string[];
  indicators: Array<SetInput['indicators'][number] & { id: string; area: string | null }>;
}

/**
 * Indicators and the Holistic Progress Card (docs/design/65, part 5): the indicator sets in three
 * levels (area → item → sub-item), the NCERT foundational-stage set for Balvatika to Class II and its
 * card. Each class is mapped to its set here (docs/design/66): a new exam that takes indicators gives
 * every class its set, and the exam's Set-up may pick another for that exam.
 */
export default async function IndicatorsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('exams.master.view')) notFound();
  const canManage = me.permissions.includes('exams.master.manage');
  const canCards = me.permissions.includes('exams.report_card.manage');
  const [sets, areaRows, scaleRows, classes] = await Promise.all([
    apiFetch<{ data: SetRow[] }>('/exams/indicator-sets').then((r) => r.data),
    apiFetch<{ data: Array<{ name: string; status: string }> }>('/exams/indicator-areas').then(
      (r) => r.data,
    ),
    apiFetch<{ data: Array<{ name: string; levels: string[]; status: string }> }>(
      '/exams/indicator-scales',
    ).then((r) => r.data),
    apiFetch<Page<ClassRow>>('/academics/classes?size=200').then((r) => r.data),
  ]);
  const setOf = (classId: string) => sets.find((x) => x.classIds.includes(classId)) ?? null;
  const className = (id: string) => classes.find((k) => k.id === id)?.name ?? id;
  // the editor picks from the lists in use (Exams setup → Areas and level scales)
  const areaList = areaRows.filter((a) => a.status === 'active').map((a) => a.name);
  const scales = scaleRows
    .filter((x) => x.status === 'active')
    .map((x) => ({ name: x.name, levels: x.levels }));
  const hasHpc = sets.some((s) => s.code === 'HPC_FOUNDATION');
  return (
    <>
      <Breadcrumbs items={[{ label: 'Exams', href: '/exams' }, { label: 'Indicators and HPC' }]} />
      <PageHeader
        kicker="Exams"
        title="Indicators and the progress card"
        description="Co-scholastic indicators and the Holistic Progress Card for Balvatika to Class II, in up to three levels. Map each class to its set below: new exams use it (an exam's Set-up may pick another); teachers enter it in the teacher app or here."
        actions={<MasterExport master="indicators" label="Indicators" />}
      />
      <ExamSetupNav current="/exams/indicators" />
      <Notice params={sp} />
      {canManage || canCards ? (
        <Card elevated title="Ready-made" style={{ marginBottom: 'var(--sp-4)' }}>
          <p style={{ marginTop: 0 }}>
            The NCERT progress card for the foundational stage: six domains, their curricular goals
            and the competencies a teacher rates as Beginner, Progressing or Proficient (printed
            with Stream, Mountain and Sky). Edit the words after adding it.
          </p>
          <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
            {canManage ? (
              <form action={installHpcSet}>
                <Button type="submit" variant={hasHpc ? 'secondary' : 'primary'}>
                  {hasHpc ? 'The progress card set is added' : 'Add the progress card set'}
                </Button>
              </form>
            ) : null}
            {canCards ? (
              <form action={installHpcCard}>
                <Button type="submit" variant="secondary">
                  Add the progress card template
                </Button>
              </form>
            ) : null}
          </div>
        </Card>
      ) : null}
      {sets.length ? (
        <Card elevated title="Class mapping" style={{ marginBottom: 'var(--sp-4)' }}>
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            The set each class is rated on. A new exam that takes indicators gives every class its
            set; exams made before keep theirs, and an exam&rsquo;s Set-up may pick another set for
            that exam.
          </p>
          <form action={saveSetMapping}>
            {sets.map((x) => (
              <input key={x.id} type="hidden" name="setId" value={x.id} />
            ))}
            <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Class mapping">
              <table className="ep-table ep-table--dense">
                <caption className="ep-sr-only">Class mapping</caption>
                <thead>
                  <tr>
                    <th scope="col">Class</th>
                    <th scope="col">Set</th>
                  </tr>
                </thead>
                <tbody>
                  {classes.map((k) => (
                    <tr key={k.id}>
                      <th scope="row">
                        <input type="hidden" name="classId" value={k.id} />
                        {k.name}
                      </th>
                      <td>
                        <select
                          className="ep-select"
                          name={`set-${k.id}`}
                          aria-label={`Set · ${k.name}`}
                          defaultValue={setOf(k.id)?.id ?? ''}
                          disabled={!canManage}
                        >
                          <option value="">None</option>
                          {sets.map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.name} ({x.code})
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {canManage ? (
              <div className="ep-form-actions" style={{ marginTop: 'var(--sp-3)' }}>
                <Button type="submit">Save the mapping</Button>
              </div>
            ) : null}
          </form>
        </Card>
      ) : null}
      <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
        {sets.length ? (
          sets.map((s) => {
            const top = s.indicators.filter((i) => !i.parentCode);
            const areas = [...new Set(s.indicators.map((i) => i.area ?? 'Other'))];
            return (
              <Card
                key={s.id}
                elevated
                title={`${s.name} · ${s.code}`}
                actions={
                  <Badge tone={s.kind === 'hpc' ? 'info' : 'neutral'}>
                    {s.kind === 'hpc' ? 'Progress card' : 'Indicators'}
                  </Badge>
                }
              >
                <p style={{ marginTop: 0 }}>
                  Levels:{' '}
                  {s.grades
                    .map((g) => (s.levelWords[g] ? `${g} (${s.levelWords[g]})` : g))
                    .join(', ')}{' '}
                  · {s.indicators.length} items in {areas.length} areas
                </p>
                <p className="ep-field__help" style={{ marginTop: 0 }}>
                  Classes: {s.classIds.length ? s.classIds.map(className).join(', ') : 'none yet'}
                </p>
                <details>
                  <summary>The items</summary>
                  {areas.map((a) => (
                    <section key={a}>
                      <h3 className="ep-cdash__h3">{a}</h3>
                      <ul style={{ marginTop: 0 }}>
                        {top
                          .filter((i) => (i.area ?? 'Other') === a)
                          .map((i) => {
                            const kids = s.indicators.filter((k) => k.parentCode === i.code);
                            return (
                              <li key={i.code}>
                                {i.code} · {i.name}
                                {i.kind === 'text' ? ' (written)' : ''}
                                {i.levels?.length ? ` (levels: ${i.levels.join(', ')})` : ''}
                                {kids.length ? (
                                  <ul>
                                    {kids.map((k) => (
                                      <li key={k.code}>
                                        {k.code} · {k.name}
                                        {k.kind === 'text' ? ' (written)' : ''}
                                      </li>
                                    ))}
                                  </ul>
                                ) : null}
                              </li>
                            );
                          })}
                      </ul>
                    </section>
                  ))}
                </details>
                {canManage ? (
                  <details>
                    <summary>Change</summary>
                    <IndicatorSetEditor
                      initial={{
                        code: s.code,
                        name: s.name,
                        kind: s.kind,
                        grades: s.grades,
                        levelWords: s.levelWords,
                        indicators: s.indicators.map(({ id: _id, area, ...i }) => ({
                          ...i,
                          area: area ?? undefined,
                        })),
                      }}
                      areas={areaList}
                      scales={scales}
                      canAddArea={canManage}
                    />
                  </details>
                ) : null}
              </Card>
            );
          })
        ) : (
          <Card>
            <p style={{ margin: 0 }}>No indicator set yet.</p>
          </Card>
        )}
        {canManage ? (
          <Card elevated title="A new set">
            <IndicatorSetEditor areas={areaList} scales={scales} canAddArea={canManage} />
          </Card>
        ) : null}
      </div>
    </>
  );
}
