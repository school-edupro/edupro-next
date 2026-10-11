import { Badge, Button, Card, DataTable, PageHeader, SelectField } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import type { Page, Withdrawal } from '@/lib/types';

const tone = (s: Withdrawal['status']) =>
  s === 'completed'
    ? 'success'
    : s === 'cancelled'
      ? 'danger'
      : s === 'cleared'
        ? 'info'
        : 'warning';

/** Withdrawal register: open, waiting for me, completed or cancelled, with the step each one is at. */
export default async function WithdrawalsPage({
  searchParams,
}: {
  searchParams: Promise<{
    ok?: string;
    error?: string;
    detail?: string;
    status?: string;
    q?: string;
    classId?: string;
    section?: string;
    from?: string;
    to?: string;
    tc?: string;
    refund?: string;
    page?: string;
    size?: string;
  }>;
}) {
  const sp = await searchParams;
  const [l, c, me, classes, sections] = await Promise.all([
    getTranslations('lifecycle'),
    getTranslations('common'),
    getMe(),
    apiFetch<Page<{ id: string; code: string; name: string }>>('/academics/classes?size=200')
      .then((r) => r.data)
      .catch(() => []),
    apiFetch<{ data: Array<{ id: string; label: string }> }>('/people/sections')
      .then((r) => r.data)
      .catch(() => []),
  ]);
  const status = sp.status ?? 'open';
  const id = (v?: string) => (v && /^\d{1,18}$/.test(v) ? v : '');
  const day = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');
  const size = ['25', '50', '100', '200'].includes(sp.size ?? '') ? sp.size! : '50';
  // the filters as the API takes them: the list and the Excel / PDF files use the same
  const filters = new URLSearchParams();
  if (status === 'mine') filters.set('mine', 'true');
  else filters.set('status', status);
  if (sp.q) filters.set('q', sp.q);
  if (id(sp.classId)) filters.set('classId', id(sp.classId));
  if (id(sp.section)) filters.set('classSectionId', id(sp.section));
  if (day(sp.from)) filters.set('leavingFrom', day(sp.from));
  if (day(sp.to)) filters.set('leavingTo', day(sp.to));
  if (sp.tc === 'issued' || sp.tc === 'not_issued') filters.set('tc', sp.tc);
  if (['none', 'not_sent', 'waiting', 'paid'].includes(sp.refund ?? ''))
    filters.set('refund', sp.refund!);
  const qs = new URLSearchParams(filters);
  qs.set('size', size);
  qs.set('page', String(Math.max(1, Number(sp.page) || 1)));
  const list = await apiFetch<Page<Withdrawal>>(`/people/withdrawals?${qs.toString()}`);
  const pages = Math.max(1, Math.ceil(list.page.total / Number(size)));
  const page = Math.min(list.page.number, pages);
  // links to another page keep what was chosen on the screen
  const here = (over: Record<string, string>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...over }))
      if (v && !['ok', 'error', 'detail'].includes(k)) u.set(k, String(v));
    return u.toString();
  };
  const REFUND: Record<Withdrawal['refundState'], string> = {
    none: '—',
    not_sent: 'Not sent',
    waiting: 'Waiting',
    paid: 'Paid',
  };
  const canManage = me.permissions.includes('people.withdrawal.manage');
  return (
    <>
      <PageHeader
        kicker="People"
        title="Withdrawals"
        description="Students leaving the school: each department clears them step by step, then the TC and completion."
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/people/withdrawals/bulk">
              Bulk (class XII)
            </a>
            {canManage ? (
              <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/people/withdrawals/settings">
                Departments and steps
              </a>
            ) : null}
          </span>
        }
      />
      <Notice params={sp} />
      <Card>
        <form
          method="get"
          style={{
            display: 'flex',
            gap: 'var(--sp-3)',
            alignItems: 'flex-end',
            flexWrap: 'wrap',
            marginBottom: 'var(--sp-4)',
          }}
        >
          <SelectField
            id="status"
            name="status"
            label={l('status')}
            defaultValue={status}
            options={[
              { value: 'open', label: l('open') },
              { value: 'mine', label: 'Waiting for me' },
              { value: 'completed', label: l('withdrawalStatuses.completed') },
              { value: 'revoked', label: l('withdrawalStatuses.revoked') },
              { value: 'cancelled', label: l('withdrawalStatuses.cancelled') },
              { value: 'all', label: 'All' },
            ]}
          />
          <SelectField
            id="classId"
            name="classId"
            label="Class"
            defaultValue={id(sp.classId)}
            options={[
              { value: '', label: 'All classes' },
              ...classes.map((k) => ({ value: k.id, label: k.name || k.code })),
            ]}
          />
          <SelectField
            id="section"
            name="section"
            label="Section"
            defaultValue={id(sp.section)}
            options={[
              { value: '', label: 'All sections' },
              ...sections.map((x) => ({ value: x.id, label: x.label })),
            ]}
          />
          <label className="ep-field" htmlFor="from" style={{ margin: 0 }}>
            <span className="ep-field__label">Leaving from</span>
            <input
              id="from"
              name="from"
              type="date"
              className="ep-input"
              defaultValue={day(sp.from)}
            />
          </label>
          <label className="ep-field" htmlFor="to" style={{ margin: 0 }}>
            <span className="ep-field__label">Leaving to</span>
            <input id="to" name="to" type="date" className="ep-input" defaultValue={day(sp.to)} />
          </label>
          <SelectField
            id="tc"
            name="tc"
            label="TC"
            defaultValue={sp.tc ?? ''}
            options={[
              { value: '', label: 'Any' },
              { value: 'issued', label: 'Issued' },
              { value: 'not_issued', label: 'Not issued' },
            ]}
          />
          <SelectField
            id="refund"
            name="refund"
            label="Refund"
            defaultValue={sp.refund ?? ''}
            options={[
              { value: '', label: 'Any' },
              { value: 'not_sent', label: 'Not sent (draft)' },
              { value: 'waiting', label: 'Waiting for approval' },
              { value: 'paid', label: 'Paid' },
              { value: 'none', label: 'No refund' },
            ]}
          />
          <SelectField
            id="size"
            name="size"
            label="Per page"
            defaultValue={size}
            options={['25', '50', '100', '200'].map((n) => ({ value: n, label: n }))}
          />
          <label className="ep-field" htmlFor="q" style={{ margin: 0 }}>
            <span className="ep-field__label">Student or admission no</span>
            <input id="q" name="q" className="ep-input" defaultValue={sp.q ?? ''} maxLength={80} />
          </label>
          <Button type="submit" variant="secondary">
            {c('apply')}
          </Button>
          <a className="ep-btn ep-btn--ghost" href="/people/withdrawals">
            Clear
          </a>
        </form>
        <div
          style={{
            display: 'flex',
            gap: 'var(--sp-2)',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            marginBottom: 'var(--sp-3)',
          }}
        >
          <span className="ep-field__help" aria-live="polite">
            {list.page.total
              ? `Showing ${String((page - 1) * Number(size) + 1)}–${String(Math.min(page * Number(size), list.page.total))} of ${String(list.page.total)}`
              : 'No records'}
          </span>
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)' }}>
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={`/api/people/withdrawals-file?format=xlsx&${filters.toString()}`}
            >
              Excel
            </a>
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={`/api/people/withdrawals-file?format=pdf&${filters.toString()}`}
            >
              PDF
            </a>
          </span>
        </div>
        <DataTable<Withdrawal>
          caption="Withdrawals"
          density="dense"
          columns={[
            {
              key: 'student',
              header: l('student'),
              render: (w) => (
                <a href={`/people/withdrawals/${w.id}`}>
                  {w.studentName} · {w.admissionNo}
                </a>
              ),
            },
            { key: 'section', header: 'Class', render: (w) => w.section ?? '' },
            { key: 'started', header: 'Started', render: (w) => w.initiatedOn },
            { key: 'leaving', header: l('leavingOn'), render: (w) => w.leavingOn },
            { key: 'reason', header: l('reason'), render: (w) => w.reason },
            {
              key: 'progress',
              header: 'Departments',
              render: (w) => (
                <span style={{ display: 'inline-flex', gap: 'var(--sp-1)', flexWrap: 'wrap' }}>
                  {w.clearances.map((x) => (
                    <Badge
                      key={x.id}
                      tone={
                        x.status === 'cleared'
                          ? 'success'
                          : x.status === 'hold'
                            ? 'danger'
                            : x.step === w.currentStep
                              ? 'warning'
                              : 'neutral'
                      }
                    >
                      {x.departmentName}
                    </Badge>
                  ))}
                </span>
              ),
            },
            {
              key: 'tc',
              header: 'TC',
              render: (w) => (w.tc ? w.tc.tcNo : w.canIssueTc ? 'ready' : '—'),
            },
            {
              key: 'refund',
              header: 'Refund',
              render: (w) =>
                w.refundState === 'none'
                  ? REFUND.none
                  : `${REFUND[w.refundState]} · ₹${Number(w.refundAmount).toLocaleString('en-IN')}`,
            },
            {
              key: 'status',
              header: l('status'),
              render: (w) => (
                <Badge tone={tone(w.status)}>
                  {l(`withdrawalStatuses.${w.status}`)}
                  {w.status === 'requested' && w.currentStep
                    ? ` · step ${String(w.currentStep)}`
                    : ''}
                </Badge>
              ),
            },
          ]}
          rows={list.data}
          rowKey={(w) => w.id}
          emptyTitle={status === 'mine' ? 'Nothing is waiting for you.' : l('noWithdrawals')}
        />
        {pages > 1 ? (
          <nav
            aria-label="Pages"
            style={{
              display: 'flex',
              gap: 'var(--sp-3)',
              alignItems: 'center',
              marginTop: 'var(--sp-3)',
            }}
          >
            {page > 1 ? (
              <a
                className="ep-btn ep-btn--secondary ep-btn--sm"
                href={`?${here({ page: String(page - 1) })}`}
              >
                ← Previous
              </a>
            ) : null}
            <span className="ep-field__help">
              Page {page} of {pages}
            </span>
            {page < pages ? (
              <a
                className="ep-btn ep-btn--secondary ep-btn--sm"
                href={`?${here({ page: String(page + 1) })}`}
              >
                Next →
              </a>
            ) : null}
          </nav>
        ) : null}
      </Card>
    </>
  );
}
