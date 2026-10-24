import { actOnStep__decision } from '@/lib/choice-actions';
import { NoEnterSubmit } from '@/components/NoEnterSubmit';
import { Badge, Button, Card, FormRow, InputField, PageHeader } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { actOnStep } from '@/lib/actions';
import { apiFetch } from '@/lib/api';
import type { InboxItem } from '@/lib/types';
import { MessagePreview, type PreviewItem } from '@/components/comms/MessagePreview';

/** S9-01: the approver's inbox; each card is one pending step assigned to the signed-in user. */
export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const [t, w, items] = await Promise.all([
    getTranslations('pages.workflow_inbox'),
    getTranslations('workflow'),
    apiFetch<{ data: InboxItem[] }>('/workflow/inbox').then((r) => r.data),
  ]);
  // message approvals: the approver reads exactly what goes out before deciding
  const previews = new Map<string, PreviewItem[]>(
    await Promise.all(
      items
        .filter((s) => s.instance.entityType === 'message_request')
        .map(
          async (s) =>
            [
              s.instance.entityId,
              await apiFetch<{ preview: PreviewItem[] }>(
                `/comms/requests/${s.instance.entityId}/preview`,
              )
                .then((r) => r.preview)
                .catch(() => [] as PreviewItem[]),
            ] as [string, PreviewItem[]],
        ),
    ),
  );
  return (
    <>
      <PageHeader
        kicker={t('kicker')}
        title={t('title')}
        description={t('description')}
        actions={<Badge tone={items.length ? 'warning' : 'neutral'}>{items.length}</Badge>}
      />
      <Notice params={sp} />
      {items.length === 0 ? <Card>{w('noSteps')}</Card> : null}
      <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
        {items.map((s) => (
          <Card
            key={s.id}
            title={s.instance.subject}
            actions={
              <span style={{ display: 'inline-flex', gap: 'var(--sp-1)', alignItems: 'center' }}>
                <Badge tone="info">
                  {w('level')} {s.level} · {s.name}
                </Badge>
                {s.dueAt ? (
                  <Badge tone={s.overdue ? 'danger' : 'neutral'}>
                    {new Date(s.dueAt).toLocaleString('en-IN', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </Badge>
                ) : null}
                <a
                  className="ep-btn ep-btn--ghost ep-btn--sm"
                  href={`/workflow/instances/${s.instance.id}`}
                >
                  #{s.instance.id}
                </a>
              </span>
            }
          >
            <p className="ep-field__help">
              {s.instance.definitionName} · {w('requestedBy')} {s.instance.requestedBy ?? '—'} ·{' '}
              {w('requestedAt')} {new Date(s.instance.requestedAt).toLocaleString('en-IN')}
            </p>
            {s.instance.entityType === 'message_request' ? (
              <>
                <MessagePreview items={previews.get(s.instance.entityId) ?? []} />
                <p style={{ marginTop: 'var(--sp-2)' }}>
                  <a href={`/comms/requests/${s.instance.entityId}`}>
                    Open the request (recipients, attachments)
                  </a>
                </p>
              </>
            ) : null}
            {s.instance.entityType === 'application' ? (
              <p style={{ marginTop: 'var(--sp-2)' }}>
                <a href={`/admissions/applications/${s.instance.entityId}`}>{w('viewEntity')}</a>
              </p>
            ) : null}
            {s.instance.entityType === 'student_correction' ? (
              <CorrectionPreview payload={s.instance.payload} />
            ) : null}
            {s.instance.entityType === 'class_correction' ? (
              <ClassCorrectionPreview payload={s.instance.payload} />
            ) : null}
            {s.instance.entityType === 'vacancy' ? (
              <p style={{ marginTop: 'var(--sp-2)' }}>
                <a href={`/people/recruitment/${s.instance.entityId}`}>{w('viewEntity')}</a>
              </p>
            ) : null}
            <form action={actOnStep} style={{ marginTop: 'var(--sp-3)' }}>
              <NoEnterSubmit />
              <input type="hidden" name="id" value={s.id} />
              <FormRow columns={2}>
                <InputField id={`note-${s.id}`} name="note" label={w('note')} maxLength={500} />
              </FormRow>
              <div style={{ display: 'flex', gap: 'var(--sp-2)', marginTop: 'var(--sp-2)' }}>
                <Button type="submit" formAction={actOnStep__decision.bind(null, 'approve')}>
                  {w('approve')}
                </Button>
                <Button
                  type="submit"
                  formAction={actOnStep__decision.bind(null, 'reject')}
                  variant="danger"
                >
                  {w('reject')}
                </Button>
              </div>
            </form>
          </Card>
        ))}
      </div>
    </>
  );
}

/** A student detail correction: each field, old and new, the reason and the student's page. */
function CorrectionPreview({ payload }: { payload: Record<string, unknown> }) {
  const changes = (payload.changes ?? []) as Array<{
    key: string;
    label: string;
    from: string | null;
    to: string | null;
  }>;
  return (
    <div style={{ marginTop: 'var(--sp-2)', display: 'grid', gap: 'var(--sp-1)' }}>
      <ul style={{ margin: 0 }}>
        {changes.map((c) => (
          <li key={c.key}>
            {c.label}: {c.from ?? '(blank)'} → <strong>{c.to ?? '(blank)'}</strong>
          </li>
        ))}
      </ul>
      <p style={{ margin: 0 }}>Reason: {String(payload.reason ?? '')}</p>
      {typeof payload.studentId === 'string' ? (
        <p style={{ margin: 0 }}>
          <a href={`/people/students/${payload.studentId}?tab=profile`}>
            Open {String(payload.student ?? 'the student')}
            {payload.admissionNo ? ` (${String(payload.admissionNo)})` : ''}
          </a>
        </p>
      ) : null}
    </div>
  );
}

/** A class correction: from and to, the date, the fee due before and after, the advance. */
function ClassCorrectionPreview({ payload }: { payload: Record<string, unknown> }) {
  const fee = (payload.fee ?? {}) as {
    before?: { due: number; charged: number };
    after?: { due: number; charged: number };
    advance?: number;
  };
  const rs = (n: number | undefined) => `Rs. ${(n ?? 0).toLocaleString('en-IN')}`;
  const d = String(payload.effectiveFrom ?? '');
  return (
    <div style={{ marginTop: 'var(--sp-2)', display: 'grid', gap: 'var(--sp-1)' }}>
      <p style={{ margin: 0 }}>
        {String(payload.from ?? '')} → <strong>{String(payload.to ?? '')}</strong> from{' '}
        {d ? `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}` : ''}
      </p>
      <p style={{ margin: 0 }}>
        Year’s fee {rs(fee.before?.charged)} → {rs(fee.after?.charged)}; due {rs(fee.before?.due)} →{' '}
        <strong>{rs(fee.after?.due)}</strong>
        {fee.advance ? `; ${rs(fee.advance)} left as advance` : ''}
      </p>
      <p style={{ margin: 0 }}>Reason: {String(payload.reason ?? '')}</p>
      {typeof payload.studentId === 'string' ? (
        <p style={{ margin: 0 }}>
          <a href={`/people/students/${payload.studentId}?tab=academics`}>
            Open {String(payload.student ?? 'the student')} (every fee line)
          </a>
        </p>
      ) : null}
    </div>
  );
}
