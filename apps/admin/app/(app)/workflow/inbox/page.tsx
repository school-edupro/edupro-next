import { Badge, Button, Card, FormRow, InputField, PageHeader } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { actOnStep } from '@/lib/actions';
import { apiFetch } from '@/lib/api';
import type { InboxItem } from '@/lib/types';

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
            {s.instance.entityType === 'application' ? (
              <p style={{ marginTop: 'var(--sp-2)' }}>
                <a href={`/admissions/applications/${s.instance.entityId}`}>{w('viewEntity')}</a>
              </p>
            ) : null}
            <form action={actOnStep} style={{ marginTop: 'var(--sp-3)' }}>
              <input type="hidden" name="id" value={s.id} />
              <FormRow columns={2}>
                <InputField id={`note-${s.id}`} name="note" label={w('note')} maxLength={500} />
              </FormRow>
              <div style={{ display: 'flex', gap: 'var(--sp-2)', marginTop: 'var(--sp-2)' }}>
                <Button type="submit" name="decision" value="approve">
                  {w('approve')}
                </Button>
                <Button type="submit" name="decision" value="reject" variant="danger">
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
