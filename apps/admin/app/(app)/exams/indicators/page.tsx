import { Badge, Breadcrumbs, Button, Card, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { IndicatorSetEditor } from '@/components/exams/IndicatorSetEditor';
import { MasterExport } from '@/components/MasterExport';
import { ExamSetupNav } from '@/components/exams/ExamSetupNav';
import { Notice } from '@/components/Notice';
import { installHpcCard, installHpcSet, type SetInput } from '@/lib/hpc-actions';
import { apiFetch, getMe } from '@/lib/api';

interface SetRow {
  id: string;
  code: string;
  name: string;
  grades: string[];
  status: string;
  kind: 'indicators' | 'hpc';
  levelWords: Record<string, string>;
  indicators: Array<SetInput['indicators'][number] & { id: string; area: string | null }>;
}

/**
 * Indicators and the Holistic Progress Card (docs/design/65, part 5): the indicator sets in three
 * levels (area → item → sub-item), the NCERT foundational-stage set for Balvatika to Class II and its
 * card. A class takes a set per exam on the exam's page.
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
  const sets = await apiFetch<{ data: SetRow[] }>('/exams/indicator-sets').then((r) => r.data);
  const hasHpc = sets.some((s) => s.code === 'HPC_FOUNDATION');
  return (
    <>
      <Breadcrumbs items={[{ label: 'Exams', href: '/exams' }, { label: 'Indicators and HPC' }]} />
      <PageHeader
        kicker="Exams"
        title="Indicators and the progress card"
        description="Co-scholastic indicators and the Holistic Progress Card for Balvatika to Class II, in up to three levels. Choose a class's set on the exam's page; teachers enter it in the teacher app or here."
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
            <IndicatorSetEditor />
          </Card>
        ) : null}
      </div>
    </>
  );
}
