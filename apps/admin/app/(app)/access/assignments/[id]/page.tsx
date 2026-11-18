import { Badge, Breadcrumbs, Button, Card, PageHeader } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { ConfirmAction } from '@/components/ConfirmAction';
import { Notice } from '@/components/Notice';
import { dmy } from '@/lib/access-assignments';
import { revokeAssignment, setAssignmentScopes } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import { sectionBound } from '@/lib/section-bound';
import type { Assignment, ClassRow, Page, SectionRow } from '@/lib/types';

/**
 * One role assignment (Access → Role assignments → Sections): the dates, reason and status, the sections it is
 * limited to (ticked by class), and Revoke with a reason.
 */
export default async function AssignmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const [a, classes, w, me] = await Promise.all([
    apiFetch<Assignment>(`/access/assignments/${id}`),
    apiFetch<Page<ClassRow>>('/academics/classes?size=200').then((r) => r.data),
    getTranslations('accessAssignments'),
    getMe(),
  ]);
  const canManage = me.permissions.includes('access.assignment.manage');
  const sections = await Promise.all(
    classes.map((c) =>
      apiFetch<{ data: SectionRow[] }>(`/academics/classes/${c.id}/sections`)
        .then((r) => ({ cls: c, sections: r.data }))
        .catch(() => ({ cls: c, sections: [] as SectionRow[] })),
    ),
  );
  const selected = new Set(a.scopes.filter((s) => s.type === 'class_section').map((s) => s.id));
  const today = new Date().toISOString().slice(0, 10);
  const state = a.revokedAt
    ? 'revoked'
    : a.validFrom > today
      ? 'upcoming'
      : a.validTo && a.validTo < today
        ? 'ended'
        : 'active';
  const tone = {
    active: 'success',
    upcoming: 'info',
    ended: 'neutral',
    revoked: 'danger',
  } as const;
  const stateText =
    state === 'upcoming'
      ? w('state_upcoming', { d: dmy(a.validFrom) })
      : state === 'ended'
        ? w('state_ended', { d: dmy(a.validTo) })
        : w(`state_${state}`);
  const back = `/access/assignments/${a.id}`;

  return (
    <>
      <Breadcrumbs
        items={[
          { label: w('kicker'), href: '/access/assignments' },
          {
            label: w('title'),
            href: `/access/assignments?userId=${a.userId}&people=all&status=all`,
          },
          { label: `${a.userName} · ${a.roleName}` },
        ]}
      />
      <PageHeader
        kicker={w('kicker')}
        title={w('d_title', { name: a.userName, role: a.roleName })}
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-3)', alignItems: 'center' }}>
            <Badge tone={tone[state]}>{stateText}</Badge>
            {canManage && (state === 'active' || state === 'upcoming') ? (
              <ConfirmAction
                action={revokeAssignment}
                fields={{ id: a.id, back }}
                label={w('revoke')}
                title={w('revokeTitle', { role: a.roleName, name: a.userName })}
                confirmLabel={w('revoke')}
                variant="ghost"
                confirmVariant="danger"
                reason={{ label: w('revokeReason'), placeholder: w('revokeReasonPh') }}
              >
                {w('revokeBody')}
              </ConfirmAction>
            ) : null}
          </span>
        }
      />
      <Notice params={sp} />
      <dl
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 'var(--sp-2) var(--sp-6)',
          margin: '0 0 var(--sp-4)',
        }}
      >
        <div>
          <dt className="ep-field__label">{w('d_dates')}</dt>
          <dd style={{ margin: 0 }}>
            {a.validTo
              ? w('fromTo', { from: dmy(a.validFrom), to: dmy(a.validTo) })
              : w('from', { d: dmy(a.validFrom) })}
          </dd>
        </div>
        <div>
          <dt className="ep-field__label">{w('d_reason')}</dt>
          <dd style={{ margin: 0 }}>{a.reason ?? '—'}</dd>
        </div>
      </dl>
      <Card title={w('d_scopes')}>
        <p className="ep-field__help" style={{ marginTop: 0 }}>
          {a.revokedAt
            ? w('d_revoked')
            : w(sectionBound(a) ? 'd_scopesHelpTeacher' : 'd_scopesHelp')}
        </p>
        <form action={setAssignmentScopes} style={{ display: 'grid', gap: 'var(--sp-4)' }}>
          <input type="hidden" name="id" value={a.id} />
          {sections.length === 0 ? <p>{w('d_noClasses')}</p> : null}
          {sections.map(({ cls, sections: secs }) => (
            <fieldset key={cls.id} style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="ep-kicker" style={{ padding: 0 }}>
                {cls.name}
              </legend>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-3)' }}>
                {secs.length === 0 ? (
                  <span className="ep-field__help">{w('d_noSections')}</span>
                ) : null}
                {secs.map((s) => (
                  <label key={s.id} className="ep-check" htmlFor={`sec-${s.id}`}>
                    <input
                      id={`sec-${s.id}`}
                      type="checkbox"
                      name="sectionIds"
                      value={s.id}
                      className="ep-check__input"
                      defaultChecked={selected.has(s.id)}
                      disabled={!!a.revokedAt || !canManage}
                    />
                    <span className="ep-check__box" aria-hidden="true" />
                    <span className="ep-check__text">{`${cls.code}-${s.name}`}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
          {a.revokedAt || !canManage ? null : (
            <div>
              <Button type="submit">{w('d_save')}</Button>
            </div>
          )}
        </form>
      </Card>
    </>
  );
}
