import { Badge, Button, Card, DataTable, FormRow, InputField, PageHeader } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import {
  cutoverRunStatus,
  cutoverSignOff,
  cutoverSnapshotLegacy,
  cutoverSnapshotLive,
  cutoverStep,
} from '@/lib/actions';
import { apiFetch } from '@/lib/api';

interface Step {
  id: string;
  sequence: number;
  phase: string;
  code: string;
  title: string;
  ownerRole: string | null;
  status: string;
  doneAt: string | null;
  doneBy: string | null;
  durationS: number | null;
  note: string | null;
}
interface Run {
  id: string;
  kind: string;
  name: string;
  status: string;
  notes: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  signedOffBy: string | null;
  signedOffAt: string | null;
  durationS: number;
  steps: Step[];
  snapshots: Array<{
    id: string;
    source: string;
    counts: Record<string, unknown>;
    takenAt: string;
    takenBy: string | null;
  }>;
  reconciliation: {
    ready: boolean;
    mismatches: number;
    rows: Array<{
      measure: string;
      legacy: number;
      live: number;
      diff: number;
      withinTolerance: boolean;
    }>;
  };
  tolerancePct: number;
}
const MEASURES = [
  'students',
  'guardians',
  'employees',
  'enrolments',
  'fee_demand',
  'receipts',
  'receipt_amount',
  'attendance_marks',
  'exam_results',
];
const hms = (s: number | null) =>
  s == null ? '' : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ${s % 60}s`;
const tone = (s: string) =>
  s === 'done' ? 'success' : s === 'failed' ? 'danger' : s === 'skipped' ? 'neutral' : 'warning';

/** Sprint 22: one cut-over run: timed steps, snapshots, reconciliation and sign-off. */
export default async function CutoverRunPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const [t, o, run] = await Promise.all([
    getTranslations('pages.system_cutover'),
    getTranslations('ops'),
    apiFetch<Run>(`/ops/cutover/runs/${id}`),
  ]);
  const legacy = run.snapshots.find((s) => s.source === 'legacy');
  const live = run.snapshots.find((s) => s.source === 'live');
  const closed = run.status === 'done' || run.status === 'aborted';
  const phases = [...new Set(run.steps.map((s) => s.phase))];
  return (
    <>
      <PageHeader
        kicker={t('kicker')}
        title={run.name}
        description={`${run.kind === 'final' ? o('final') : o('rehearsal')} · ${o('elapsed')} ${hms(run.durationS)}${run.notes ? ` · ${run.notes}` : ''}`}
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
            <Badge
              tone={
                run.status === 'done'
                  ? 'success'
                  : run.status === 'aborted'
                    ? 'danger'
                    : run.status === 'running'
                      ? 'info'
                      : 'neutral'
              }
            >
              {run.status}
            </Badge>
            {!closed ? (
              <form
                action={cutoverRunStatus}
                style={{ display: 'inline-flex', gap: 'var(--sp-1)' }}
              >
                <input type="hidden" name="runId" value={run.id} />
                {run.status === 'planned' ? (
                  <Button type="submit" name="status" value="running" size="sm" variant="secondary">
                    {o('start')}
                  </Button>
                ) : null}
                <Button type="submit" name="status" value="aborted" size="sm" variant="ghost">
                  {o('abort')}
                </Button>
              </form>
            ) : null}
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/system/cutover">
              ←
            </a>
          </span>
        }
      />
      <Notice params={sp} />
      {phases.map((phase) => (
        <Card
          key={phase}
          title={`${o('phase')}: ${phase.replace(/_/g, ' ')}`}
          style={{ marginBottom: 'var(--sp-4)' }}
        >
          <DataTable<Step>
            caption={phase}
            density="dense"
            columns={[
              { key: 'n', header: '#', numeric: true, render: (s) => s.sequence / 10 },
              {
                key: 't',
                header: o('steps'),
                render: (s) => (
                  <>
                    <strong>{s.title}</strong>
                    <div className="ep-kicker">
                      {s.code} · {s.ownerRole ?? ''}
                      {s.note ? ` · ${s.note}` : ''}
                    </div>
                  </>
                ),
              },
              {
                key: 'st',
                header: o('status'),
                render: (s) => (
                  <>
                    <Badge tone={tone(s.status)}>{s.status}</Badge>
                    {s.doneAt ? (
                      <div className="ep-kicker">
                        {s.doneBy ?? ''} · {s.doneAt.slice(0, 16).replace('T', ' ')} ·{' '}
                        {hms(s.durationS)}
                      </div>
                    ) : null}
                  </>
                ),
              },
              {
                key: 'a',
                header: '',
                render: (s) =>
                  closed ? null : (
                    <form
                      action={cutoverStep}
                      style={{ display: 'inline-flex', gap: 'var(--sp-1)', alignItems: 'flex-end' }}
                    >
                      <input type="hidden" name="runId" value={run.id} />
                      <input type="hidden" name="stepId" value={s.id} />
                      <InputField id={`n-${s.id}`} name="note" label={o('note')} maxLength={1000} />
                      {s.status === 'pending' ? (
                        <>
                          <Button type="submit" name="status" value="done" size="sm">
                            {o('done')}
                          </Button>
                          <Button
                            type="submit"
                            name="status"
                            value="skipped"
                            size="sm"
                            variant="ghost"
                          >
                            {o('skip')}
                          </Button>
                          <Button
                            type="submit"
                            name="status"
                            value="failed"
                            size="sm"
                            variant="ghost"
                          >
                            {o('fail')}
                          </Button>
                        </>
                      ) : (
                        <Button
                          type="submit"
                          name="status"
                          value="pending"
                          size="sm"
                          variant="ghost"
                        >
                          {o('reset')}
                        </Button>
                      )}
                    </form>
                  ),
              },
            ]}
            rows={run.steps.filter((s) => s.phase === phase)}
            rowKey={(s) => s.id}
            emptyTitle="—"
          />
        </Card>
      ))}
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-5)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))',
        }}
      >
        <Card title={o('legacyCounts')}>
          <form action={cutoverSnapshotLegacy}>
            <input type="hidden" name="runId" value={run.id} />
            <FormRow columns={3}>
              {MEASURES.map((m) => (
                <InputField
                  key={m}
                  id={`c-${m}`}
                  name={`count.${m}`}
                  label={m}
                  defaultValue={legacy ? String(legacy.counts[m] ?? '') : ''}
                  inputMode="decimal"
                />
              ))}
            </FormRow>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-2)' }}>
              <span className="ep-kicker">
                {legacy
                  ? `${o('takenAt')} ${legacy.takenAt.slice(0, 16).replace('T', ' ')} · ${legacy.takenBy ?? ''}`
                  : ''}
              </span>
              {!closed ? (
                <Button type="submit" variant="secondary" size="sm">
                  {o('saveLegacy')}
                </Button>
              ) : null}
            </div>
          </form>
        </Card>
        <Card
          title={o('reconciliation')}
          actions={
            !closed ? (
              <form action={cutoverSnapshotLive}>
                <input type="hidden" name="runId" value={run.id} />
                <Button type="submit" size="sm" variant="secondary">
                  {o('snapshotLive')}
                </Button>
              </form>
            ) : undefined
          }
        >
          <p className="ep-kicker">
            {o('tolerance')} {run.tolerancePct}%{' '}
            {live
              ? `· ${o('live')} ${o('takenAt')} ${live.takenAt.slice(0, 16).replace('T', ' ')}`
              : ''}
          </p>
          <DataTable<Run['reconciliation']['rows'][number]>
            caption={o('reconciliation')}
            density="dense"
            columns={[
              { key: 'm', header: o('measure'), render: (r) => r.measure },
              {
                key: 'l',
                header: o('legacy'),
                numeric: true,
                render: (r) => r.legacy.toLocaleString('en-IN'),
              },
              {
                key: 'v',
                header: o('live'),
                numeric: true,
                render: (r) => r.live.toLocaleString('en-IN'),
              },
              {
                key: 'd',
                header: o('diff'),
                numeric: true,
                render: (r) => (
                  <Badge tone={r.withinTolerance ? 'success' : 'danger'}>
                    {r.diff > 0 ? `+${r.diff}` : r.diff}
                  </Badge>
                ),
              },
            ]}
            rows={run.reconciliation.rows}
            rowKey={(r) => r.measure}
            emptyTitle="—"
          />
          {!closed ? (
            <form
              action={cutoverSignOff}
              style={{ marginTop: 'var(--sp-3)', display: 'flex', justifyContent: 'flex-end' }}
            >
              <input type="hidden" name="runId" value={run.id} />
              <Button type="submit">{o('signOff')}</Button>
            </form>
          ) : run.signedOffBy ? (
            <p className="ep-kicker">
              {o('signedOff')} {run.signedOffBy} · {run.signedOffAt?.slice(0, 16).replace('T', ' ')}
            </p>
          ) : null}
        </Card>
      </div>
    </>
  );
}
