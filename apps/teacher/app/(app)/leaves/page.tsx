import { Badge, Button, Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { FileLinks } from '@/components/FileLinks';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { approveLeave, rejectLeave } from './actions';
import { StudentLeaveFeed, leaveDays, type StudentLeave } from './StudentLeaveFeed';

/** The first page: the latest 10 (those waiting on top); the rest load as the teacher scrolls. */
const PAGE = 10;

type Leave = StudentLeave;
interface Detail extends Leave {
  files: Array<{ id: string; name: string }>;
  approvals: Array<{
    seq: number;
    label: string;
    status: string;
    actedBy: string | null;
    approvers: string | null;
    note: string | null;
  }>;
  canDecide: boolean;
}
const TONE: Record<string, 'warning' | 'success' | 'danger' | 'neutral'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
};
const days = leaveDays;

/**
 * Student leave for the teacher: what waits for their approval, and what they decided. An approved leave
 * shows as LV in the class and the bus roll and cannot be changed there.
 */
export default async function TeacherLeavesPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    open?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const tab = sp.tab === 'all' ? 'all' : 'inbox';
  let list: { data: Leave[]; inbox: number; page: { total: number } | null };
  try {
    list = await bff.api.fetch(`/attendance/leaves?tab=${tab}&page=1&size=${String(PAGE)}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && error.status === 403)
      return (
        <main style={{ padding: 'var(--sp-4)', maxWidth: 820, margin: '0 auto' }}>
          <PageHeader kicker="EduPro" title="Student leave" />
          <Card>Approving student leave is not part of your role.</Card>
        </main>
      );
    throw error;
  }
  const lang = await currentLang();
  const foot = {
    more: t(lang, 'Show more'),
    loading: t(lang, 'Loading…'),
    failed: t(lang, 'Could not load more.'),
    end: t(lang, 'That is everything.'),
  };
  const open = /^\d+$/.test(sp.open ?? '')
    ? await bff.api.fetch<Detail>(`/attendance/leaves/${sp.open!}`).catch(() => null)
    : null;
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 820, margin: '0 auto' }}>
      <PageHeader
        kicker="Attendance"
        title="Student leave"
        description="Leave the families applied for that waits for your approval."
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/">
            Home
          </a>
        }
      />
      {sp.ok ? (
        <div
          className="ep-alert ep-alert--success"
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {sp.ok === 'approved'
            ? 'Approved at your level.'
            : 'Not approved. The family sees it in the portal.'}
        </div>
      ) : null}
      {sp.error ? (
        <div
          className="ep-alert ep-alert--danger"
          role="alert"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {sp.detail || sp.error}
        </div>
      ) : null}
      <nav className="ep-tabs-links" aria-label="Lists" style={{ marginBottom: 'var(--sp-3)' }}>
        <a href="/leaves" aria-current={tab === 'inbox' ? 'page' : undefined}>
          To approve · {list.inbox}
        </a>
        <a href="/leaves?tab=all" aria-current={tab === 'all' ? 'page' : undefined}>
          All that came to me
        </a>
      </nav>
      {open ? (
        <Card title={`${open.number} · ${open.student}`} style={{ marginBottom: 'var(--sp-3)' }}>
          <p style={{ marginTop: 0 }}>
            {[open.section, open.admissionNo].filter(Boolean).join(' · ')} ·{' '}
            <strong>{open.leaveTypeLabel}</strong> · {days(open)}
            {open.long ? ' · long leave' : ''}
          </p>
          <p>
            <span className="ep-kicker">Reason</span>
            <br />
            {open.reason}
          </p>
          <p>
            <span className="ep-kicker">Certificate</span>{' '}
            {open.files.length
              ? open.files.map((f, i) => (
                  <FileLinks
                    key={f.id}
                    url={`/api/leave-file/${open.id}/${f.id}`}
                    saveUrl={`/api/leave-file/${open.id}/${f.id}?save=1`}
                    label={`attachment ${String(i + 1)} of ${open.number}`}
                  />
                ))
              : 'None attached'}
          </p>
          <ul className="ep-field__help" style={{ paddingLeft: 'var(--sp-4)' }}>
            {open.approvals.map((a) => (
              <li key={a.seq}>
                {a.label}:{' '}
                {a.status === 'approved'
                  ? `approved by ${a.actedBy ?? ''}`
                  : a.status === 'rejected'
                    ? `not approved by ${a.actedBy ?? ''}`
                    : a.status === 'pending'
                      ? `waiting for ${a.approvers ?? 'the approver'}`
                      : a.status === 'skipped'
                        ? (a.note ?? 'skipped')
                        : 'next'}
                {a.note && a.status !== 'skipped' ? ` · “${a.note}”` : ''}
              </li>
            ))}
          </ul>
          {open.canDecide ? (
            <form action={approveLeave}>
              <input type="hidden" name="id" value={open.id} />
              <label className="ep-field">
                <span className="ep-field__label">Note (needed when not approving)</span>
                <textarea name="note" className="ep-input" rows={2} maxLength={500} />
              </label>
              <div style={{ display: 'flex', gap: 'var(--sp-2)', marginTop: 'var(--sp-2)' }}>
                <Button type="submit" formAction={approveLeave}>
                  Approve
                </Button>
                <Button type="submit" formAction={rejectLeave} variant="secondary">
                  Do not approve
                </Button>
              </div>
            </form>
          ) : (
            <Badge tone={TONE[open.status] ?? 'neutral'}>
              {open.status === 'pending' && open.waitingOn
                ? `Waiting: ${open.waitingOn}`
                : open.status}
            </Badge>
          )}
        </Card>
      ) : null}
      {list.data.length === 0 ? (
        <Card>{tab === 'inbox' ? 'No leave waits for your approval.' : 'Nothing here yet.'}</Card>
      ) : (
        <StudentLeaveFeed
          key={tab}
          first={list.data}
          more={PAGE < (list.page?.total ?? 0)}
          tab={tab}
          foot={foot}
        />
      )}
    </main>
  );
}
