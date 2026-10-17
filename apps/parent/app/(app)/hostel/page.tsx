import { Badge, Button, Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { ChildSwitch } from '@/components/ChildSwitch';
import { chosenChild } from '@/lib/child';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import {
  addVisitor,
  askHostelExit,
  raiseComplaint,
  rateMeal,
  removeVisitor,
  withdrawHostelExit,
} from './actions';

interface Visitors {
  onRecord: Array<{ name: string; relation: string; mobile: string | null }>;
  visitors: Array<{
    id: string;
    name: string;
    relation: string;
    mobile: string;
    status: 'pending' | 'approved' | 'rejected';
    note: string | null;
    hasPhoto: boolean;
  }>;
}
interface Summary {
  boarder: boolean;
  stay?: {
    hostel: string;
    hostelPhone: string | null;
    block: string | null;
    room: string;
    bed: string;
    since: string;
    roomMates: number;
  };
  wardens?: Array<{ name: string; isHead: boolean; mobile: string | null }>;
  now?: {
    state: 'in_hostel' | 'home_leave' | 'outing';
    number?: string;
    returnBy?: string;
    late?: boolean;
  };
  next?: {
    number: string;
    kind: string;
    onDate: string;
    atTime: string | null;
    state: string;
  } | null;
  lastRoll?: { label: string; session: string; on: string; at: string; status: string } | null;
  todayMenu?: Array<{ meal: string; atTime: string; items: string | null; changed: boolean }>;
  passes?: Array<{
    id: string;
    number: string;
    kind: string;
    state: string;
    onDate: string;
    atTime: string | null;
    returnBy: string | null;
    outAt: string | null;
    inAt: string | null;
    lateMinutes: number | null;
    reason: string;
  }>;
}
const TABS = [
  ['leave', 'Leave and outings'],
  ['visitors', 'Visitors'],
  ['mess', 'Mess'],
  ['complaints', 'Complaints'],
  ['notes', 'From the hostel'],
  ['leaving', 'Leaving the hostel'],
] as const;
const PASS_STATE: Record<string, [string, 'success' | 'warning' | 'danger' | 'neutral' | 'info']> =
  {
    pending: ['Waiting for approval', 'warning'],
    approved: ['Approved', 'success'],
    handed_over: ['Handed over', 'info'],
    out: ['Out', 'info'],
    returned: ['Back', 'neutral'],
    rejected: ['Not approved', 'danger'],
    cancelled: ['Cancelled', 'neutral'],
  };

interface ExitInfo {
  hostel: string | null;
  requests: Array<{
    id: string;
    leavingOn: string;
    reason: string;
    note: string | null;
    status: 'pending' | 'started' | 'declined' | 'withdrawn';
    declineNote: string | null;
    createdAt: string;
  }>;
  withdrawals: Array<{
    id: string;
    leavingOn: string;
    status: string;
    completedAt: string | null;
  }>;
}
interface Menu {
  hostel: { id: string; name: string } | null;
  /** the child has left the hostel */
  left?: { on: string; hostel: string; feeUntil: string | null } | null;
  diet: {
    diet: string;
    dietName: string | null;
    noOnionGarlic: boolean;
    allergies: string[] | null;
    notes: string | null;
  } | null;
  week: {
    weekOf: string;
    meals: Array<{ id: string; name: string; atTime: string }>;
    days: Array<{
      date: string;
      meals: Array<{ mealId: string; items: string | null; changed: boolean; note: string | null }>;
    }>;
  } | null;
}

interface Complaint {
  id: string;
  number: string;
  status: string;
  subject: string;
  head: string;
  openedAt: string;
  closedAt: string | null;
  resolution: string | null;
}
interface Incident {
  id: string;
  occurredAt: string;
  category: string;
  what: string;
  action: string | null;
}
const CSTATUS: Record<string, [string, 'warning' | 'info' | 'success' | 'neutral']> = {
  open: ['Open', 'warning'],
  in_progress: ['Being worked on', 'info'],
  answered: ['Answered', 'success'],
  closed: ['Closed', 'neutral'],
};
const CATEGORY: Record<string, string> = {
  discipline: 'Discipline',
  health: 'Health',
  safety: 'Safety',
  property: 'Property',
  other: 'Other',
};

const DIET: Record<string, string> = {
  veg: 'Vegetarian',
  non_veg: 'Non-vegetarian',
  eggetarian: 'Vegetarian with egg',
  jain: 'Jain',
  vegan: 'Vegan',
};
const STATUS: Record<string, [string, 'success' | 'warning' | 'danger']> = {
  approved: ['Approved', 'success'],
  pending: ['Waiting for the warden', 'warning'],
  rejected: ['Not approved', 'danger'],
};

/** The child's hostel for the family: who may visit (the approved list) and this week's mess menu. */
export default async function HostelPage({
  searchParams,
}: {
  searchParams: Promise<{
    student?: string;
    ok?: string;
    error?: string;
    detail?: string;
    week?: string;
    tab?: string;
  }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  const kid = await chosenChild(sp.student);
  if (!kid) redirect('/');
  let menu: Menu;
  let visitors: Visitors | null = null;
  let complaints: Complaint[] = [];
  let heads: Array<{ code: string; name: string }> = [];
  let incidents: Incident[] = [];
  let exit: ExitInfo | null = null;
  let sum: Summary | null = null;
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : 'leave';
  let rate: Array<{
    mealId: string;
    meal: string;
    atTime: string;
    onDate: string;
    rating: number | null;
    comment: string | null;
  }> = [];
  try {
    menu = await bff.api.fetch<Menu>(
      `/hostel/mine/menu?studentId=${kid.id}${/^\d{4}-\d{2}-\d{2}$/.test(sp.week ?? '') ? `&weekOf=${sp.week}` : ''}`,
    );
    exit = await bff.api.fetch<ExitInfo>(`/hostel/mine/exit?studentId=${kid.id}`).catch(() => null);
    sum = await bff.api
      .fetch<Summary>(`/hostel/mine/summary?studentId=${kid.id}`)
      .catch(() => null);
    if (menu.hostel)
      [visitors, complaints, heads, incidents, rate] = await Promise.all([
        bff.api.fetch<Visitors>(`/hostel/mine/visitors?studentId=${kid.id}`),
        bff.api
          .fetch<{ data: Complaint[] }>(`/hostel/mine/complaints?studentId=${kid.id}`)
          .then((r) => r.data),
        bff.api
          .fetch<{ data: Array<{ code: string; name: string }> }>('/hostel/mine/complaint-heads')
          .then((r) => r.data),
        bff.api
          .fetch<{ data: Incident[] }>(`/hostel/mine/incidents?studentId=${kid.id}`)
          .then((r) => r.data),
        bff.api
          .fetch<{ data: typeof rate }>(`/hostel/mine/feedback?studentId=${kid.id}`)
          .then((r) => r.data)
          .catch(() => [] as typeof rate),
      ]);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && error.status === 403) redirect('/');
    throw error;
  }
  const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  const shift = (n: number) => {
    const d = new Date(`${menu.week?.weekOf ?? today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const when = (v: string) =>
    new Date(v).toLocaleDateString(lang === 'hi' ? 'hi-IN' : 'en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      timeZone: 'Asia/Kolkata',
    });
  const dayName = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString(lang === 'hi' ? 'hi-IN' : 'en-IN', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      timeZone: 'UTC',
    });
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 820, margin: '0 auto' }}>
      <PageHeader
        kicker={t(lang, 'Hostel')}
        title={menu.hostel ? menu.hostel.name : t(lang, 'Hostel')}
        description={t(
          lang,
          'Where your child stays, leave and outings, visitors, the mess and the warden — all in one place.',
        )}
      />
      <ChildSwitch lang={lang} back="/hostel" current={kid.id} />
      {sp.ok ? (
        <div
          className="ep-alert ep-alert--success"
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {t(
            lang,
            sp.ok === 'removed'
              ? 'Removed from the list.'
              : sp.ok === 'rated'
                ? 'Thank you. The warden sees your rating.'
                : sp.ok === 'exit'
                  ? 'Your request is sent. The hostel office will start the withdrawal or reply here.'
                  : sp.ok === 'exit-withdrawn'
                    ? 'Your request is taken back.'
                    : sp.ok === 'complaint'
                      ? 'Complaint raised. The warden will look into it.'
                      : 'Added. The warden will approve the visitor.',
          )}
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
      {menu.hostel && sum?.boarder && sum.stay ? (
        <section
          className="ep-card"
          style={{ padding: 'var(--sp-4)', marginBottom: 'var(--sp-4)' }}
          aria-label={t(lang, 'Summary')}
        >
          <div
            style={{
              display: 'grid',
              gap: 'var(--sp-4)',
              gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))',
            }}
          >
            <div>
              <div className="ep-kicker">{t(lang, 'Room')}</div>
              <strong style={{ fontSize: 'var(--fs-h4)' }}>
                {sum.stay.block ? `${sum.stay.block} · ` : ''}
                {sum.stay.room} / {sum.stay.bed}
              </strong>
              <div className="ep-field__help">
                {t(lang, 'since')} {dayName(sum.stay.since)} ·{' '}
                {sum.stay.roomMates
                  ? `${String(sum.stay.roomMates)} ${t(lang, 'room-mate(s)')}`
                  : t(lang, 'no room-mate now')}
              </div>
            </div>
            <div>
              <div className="ep-kicker">{t(lang, 'Now')}</div>
              {sum.now?.state === 'in_hostel' ? (
                <Badge tone="success">{t(lang, 'In the hostel')}</Badge>
              ) : (
                <Badge tone={sum.now?.late ? 'danger' : 'info'}>
                  {t(lang, sum.now?.state === 'home_leave' ? 'On home leave' : 'On an outing')}
                  {sum.now?.returnBy ? ` · ${t(lang, 'back by')} ${when(sum.now.returnBy)}` : ''}
                </Badge>
              )}
              {sum.lastRoll ? (
                <div className="ep-field__help" style={{ marginTop: 'var(--sp-1)' }}>
                  {t(lang, 'Last roll-call')}: {t(lang, sum.lastRoll.label)} ·{' '}
                  {sum.lastRoll.session} {dayName(sum.lastRoll.on)}
                </div>
              ) : null}
              {sum.next ? (
                <div className="ep-field__help">
                  {t(lang, sum.next.kind === 'hostel_home' ? 'Next home leave' : 'Next outing')}:{' '}
                  {dayName(sum.next.onDate)}
                  {sum.next.atTime ? ` ${sum.next.atTime}` : ''}
                </div>
              ) : null}
            </div>
            <div>
              <div className="ep-kicker">{t(lang, 'Warden')}</div>
              {(sum.wardens ?? []).slice(0, 2).map((w) => (
                <div
                  key={w.name}
                  style={{
                    display: 'flex',
                    gap: 'var(--sp-2)',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                  }}
                >
                  <strong>{w.name}</strong>
                  {w.isHead ? <span className="ep-field__help">({t(lang, 'head')})</span> : null}
                  {w.mobile ? (
                    <>
                      <a className="ep-btn ep-btn--secondary ep-btn--sm" href={`tel:${w.mobile}`}>
                        {t(lang, 'Call')}
                      </a>
                      <a
                        className="ep-btn ep-btn--secondary ep-btn--sm"
                        href={`https://wa.me/91${w.mobile.replace(/\D/g, '').slice(-10)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        WhatsApp
                      </a>
                    </>
                  ) : null}
                </div>
              ))}
              {!(sum.wardens ?? []).length ? <span className="ep-field__help">—</span> : null}
            </div>
          </div>
          {(sum.todayMenu ?? []).length ? (
            <div style={{ marginTop: 'var(--sp-4)' }}>
              <div className="ep-kicker">{t(lang, 'Today’s meals')}</div>
              <div
                style={{
                  display: 'grid',
                  gap: 'var(--sp-2)',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))',
                }}
              >
                {sum.todayMenu!.map((m) => (
                  <div key={m.meal}>
                    <strong>{t(lang, m.meal)}</strong>{' '}
                    <span className="ep-field__help">{m.atTime}</span>
                    <div>{m.items ?? '—'}</div>
                    {m.changed ? (
                      <span className="ep-field__help">{t(lang, 'Special today')}</span>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <div
            style={{
              display: 'flex',
              gap: 'var(--sp-2)',
              flexWrap: 'wrap',
              marginTop: 'var(--sp-4)',
            }}
          >
            <a
              className="ep-btn ep-btn--primary ep-btn--sm"
              href={`/gate-passes/new?student=${kid.id}&kind=hostel_home`}
            >
              {t(lang, 'Ask for home leave')}
            </a>
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={`/gate-passes/new?student=${kid.id}&kind=hostel_outing`}
            >
              {t(lang, 'Ask for an outing')}
            </a>
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={`/hostel?student=${kid.id}&tab=visitors`}
            >
              {t(lang, 'Add a visitor')}
            </a>
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={`/hostel?student=${kid.id}&tab=complaints`}
            >
              {t(lang, 'Raise a complaint')}
            </a>
          </div>
        </section>
      ) : null}
      {menu.hostel ? (
        <nav
          className="ep-tabs-links"
          aria-label={t(lang, 'Hostel')}
          style={{ marginBottom: 'var(--sp-4)' }}
        >
          {TABS.map(([k, label]) => (
            <a
              key={k}
              href={`/hostel?student=${kid.id}&tab=${k}`}
              aria-current={k === tab ? 'page' : undefined}
            >
              {t(lang, label)}
            </a>
          ))}
        </nav>
      ) : null}
      {!menu.hostel ? (
        <Card>
          {menu.left ? (
            <>
              {t(lang, 'Your child left the hostel on')}{' '}
              <strong>{when(`${menu.left.on}T12:00:00+05:30`)}</strong> ({menu.left.hostel}).
              {menu.left.feeUntil
                ? ` ${t(lang, 'The hostel fee is charged up to')} ${new Date(
                    `${menu.left.feeUntil}T00:00:00Z`,
                  ).toLocaleDateString(lang === 'hi' ? 'hi-IN' : 'en-IN', {
                    month: 'long',
                    year: 'numeric',
                    timeZone: 'UTC',
                  })}.`
                : ''}
            </>
          ) : (
            t(lang, 'Your child does not board in the hostel.')
          )}
          {(exit?.withdrawals ?? [])
            .filter((w) => w.status === 'completed')
            .map((w) => (
              <p key={w.id} style={{ marginBottom: 0 }}>
                <a
                  className="ep-btn ep-btn--secondary ep-btn--sm"
                  href={`/hostel/clearance/${w.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t(lang, 'Clearance certificate')}
                </a>
              </p>
            ))}
        </Card>
      ) : (
        <>
          {tab === 'leave' ? (
            <Card title={t(lang, 'Leave and outings')}>
              {(sum?.passes ?? []).length === 0 ? (
                <p className="ep-field__help">{t(lang, 'No hostel leave or outing yet.')}</p>
              ) : (
                <ul className="fp-rcpts">
                  {sum!.passes!.map((p) => (
                    <li key={p.id}>
                      <span>
                        <strong>
                          {t(lang, p.kind === 'hostel_home' ? 'Home leave' : 'Outing')} ·{' '}
                          {dayName(p.onDate)}
                          {p.atTime ? ` ${p.atTime}` : ''}
                        </strong>{' '}
                        <span className="ep-field__help">
                          {p.number}
                          {p.returnBy ? ` · ${t(lang, 'back by')} ${when(p.returnBy)}` : ''}
                          {p.inAt ? ` · ${t(lang, 'back on')} ${when(p.inAt)}` : ''}
                        </span>
                        <span className="ep-field__help" style={{ display: 'block' }}>
                          {p.reason}
                        </span>
                      </span>
                      <span style={{ display: 'flex', gap: 'var(--sp-1)', flexWrap: 'wrap' }}>
                        <Badge tone={PASS_STATE[p.state]?.[1] ?? 'neutral'}>
                          {t(lang, PASS_STATE[p.state]?.[0] ?? p.state)}
                        </Badge>
                        {p.lateMinutes ? (
                          <Badge tone="danger">
                            {t(lang, 'Late')} {p.lateMinutes} min
                          </Badge>
                        ) : null}
                        <a
                          className="ep-btn ep-btn--secondary ep-btn--sm"
                          href={`/gate-passes/${p.id}`}
                        >
                          {t(lang, 'Open')}
                        </a>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <div
                style={{
                  display: 'flex',
                  gap: 'var(--sp-2)',
                  flexWrap: 'wrap',
                  marginTop: 'var(--sp-3)',
                }}
              >
                <a
                  className="ep-btn ep-btn--primary ep-btn--sm"
                  href={`/gate-passes/new?student=${kid.id}&kind=hostel_home`}
                >
                  {t(lang, 'Ask for home leave')}
                </a>
                <a
                  className="ep-btn ep-btn--secondary ep-btn--sm"
                  href={`/gate-passes/new?student=${kid.id}&kind=hostel_outing`}
                >
                  {t(lang, 'Ask for an outing')}
                </a>
              </div>
            </Card>
          ) : null}
          {tab === 'visitors' ? (
            <>
              <Card title={t(lang, 'Approved visitors')} style={{ marginBottom: 'var(--sp-4)' }}>
                <p className="ep-field__help">
                  {t(
                    lang,
                    'Only people on this list may visit your child, in the hostel’s visiting hours. Anyone else waits at the gate for the warden, and you are told.',
                  )}
                </p>
                <ul className="fp-rcpts">
                  {visitors?.onRecord.map((g) => (
                    <li key={`r-${g.relation}-${g.mobile ?? ''}`}>
                      <span>
                        <strong>{g.name}</strong>
                        <span className="ep-field__help" style={{ display: 'block' }}>
                          {t(
                            lang,
                            g.relation.replace(/^\w/, (c) => c.toUpperCase()),
                          )}{' '}
                          · {g.mobile ?? '—'}
                        </span>
                      </span>
                      <Badge tone="success">{t(lang, 'On the school record')}</Badge>
                    </li>
                  ))}
                  {visitors?.visitors.map((v) => (
                    <li key={v.id}>
                      <span style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'center' }}>
                        {v.hasPhoto ? (
                          <img
                            src={`/hostel/visitor-photo/${v.id}`}
                            alt={`${v.name}`}
                            width={48}
                            height={48}
                            style={{ objectFit: 'cover', borderRadius: 'var(--radius-sm)' }}
                          />
                        ) : null}
                        <span>
                          <strong>{v.name}</strong>
                          <span className="ep-field__help" style={{ display: 'block' }}>
                            {v.relation} · {v.mobile}
                            {v.note ? ` · ${v.note}` : ''}
                          </span>
                        </span>
                      </span>
                      <span style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
                        <Badge tone={STATUS[v.status]![1]}>{t(lang, STATUS[v.status]![0])}</Badge>
                        <form action={removeVisitor}>
                          <input type="hidden" name="id" value={v.id} />
                          <input type="hidden" name="studentId" value={kid.id} />
                          <Button
                            type="submit"
                            variant="ghost"
                            size="sm"
                            aria-label={`${t(lang, 'Remove')} ${v.name}`}
                          >
                            {t(lang, 'Remove')}
                          </Button>
                        </form>
                      </span>
                    </li>
                  ))}
                </ul>
                <form
                  action={addVisitor}
                  style={{ display: 'grid', gap: 'var(--sp-3)', marginTop: 'var(--sp-4)' }}
                >
                  <h3 className="ep-field__label" style={{ margin: 0 }}>
                    {t(lang, 'Add a visitor')}
                  </h3>
                  <input type="hidden" name="studentId" value={kid.id} />
                  <label className="ep-field" htmlFor="hv-name">
                    <span className="ep-field__label">{t(lang, 'Name')} *</span>
                    <input
                      id="hv-name"
                      name="name"
                      className="ep-input"
                      required
                      minLength={2}
                      maxLength={120}
                    />
                  </label>
                  <label className="ep-field" htmlFor="hv-rel">
                    <span className="ep-field__label">{t(lang, 'Relation to the child')} *</span>
                    <input
                      id="hv-rel"
                      name="relation"
                      className="ep-input"
                      required
                      minLength={2}
                      maxLength={60}
                    />
                  </label>
                  <label className="ep-field" htmlFor="hv-mob">
                    <span className="ep-field__label">{t(lang, 'Mobile')} *</span>
                    <input
                      id="hv-mob"
                      name="mobile"
                      className="ep-input"
                      required
                      inputMode="numeric"
                      pattern="[6-9][0-9]{9}"
                      maxLength={10}
                    />
                  </label>
                  <label className="ep-field" htmlFor="hv-photo">
                    <span className="ep-field__label">{t(lang, 'Photo (helps the gate)')}</span>
                    <input
                      id="hv-photo"
                      name="photo"
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                    />
                    <span className="ep-field__help">{t(lang, 'A JPEG or PNG under 300 KB.')}</span>
                  </label>
                  <div>
                    <Button type="submit">{t(lang, 'Add to the list')}</Button>
                  </div>
                </form>
              </Card>
            </>
          ) : null}
          {tab === 'mess' ? (
            <>
              <Card
                title={`${t(lang, 'Mess menu')} · ${t(lang, 'week of')} ${menu.week ? dayName(menu.week.weekOf) : ''}`}
                actions={
                  <span style={{ display: 'flex', gap: 'var(--sp-2)' }}>
                    <a
                      className="ep-btn ep-btn--ghost ep-btn--sm"
                      href={`/hostel?student=${kid.id}&week=${shift(-7)}`}
                    >
                      {t(lang, 'Previous week')}
                    </a>
                    <a
                      className="ep-btn ep-btn--ghost ep-btn--sm"
                      href={`/hostel?student=${kid.id}&week=${shift(7)}`}
                    >
                      {t(lang, 'Next week')}
                    </a>
                  </span>
                }
              >
                {menu.diet ? (
                  <p>
                    <Badge tone="info">
                      {menu.diet.dietName ?? t(lang, DIET[menu.diet.diet] ?? menu.diet.diet)}
                      {menu.diet.noOnionGarlic ? ` · ${t(lang, 'no onion or garlic')}` : ''}
                    </Badge>{' '}
                    {(menu.diet.allergies ?? []).map((a) => (
                      <span key={a} style={{ marginRight: 'var(--sp-1)' }}>
                        <Badge tone="danger">{a}</Badge>
                      </span>
                    ))}
                    {menu.diet.notes ? (
                      <span className="ep-field__help">{menu.diet.notes}</span>
                    ) : null}
                  </p>
                ) : null}
                {!menu.week || menu.week.meals.length === 0 ? (
                  <p className="ep-field__help">
                    {t(lang, 'The hostel has not put up its menu yet.')}
                  </p>
                ) : (
                  <div className="ep-table-wrap">
                    <table className="ep-table ep-table--dense">
                      <thead>
                        <tr>
                          <th scope="col">{t(lang, 'Day')}</th>
                          {menu.week.meals.map((m) => (
                            <th key={m.id} scope="col">
                              {t(lang, m.name)} <small className="ep-field__help">{m.atTime}</small>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {menu.week.days.map((d) => (
                          <tr key={d.date} aria-current={d.date === today ? 'date' : undefined}>
                            <th scope="row">
                              {dayName(d.date)}
                              {d.date === today ? ` · ${t(lang, 'today')}` : ''}
                            </th>
                            {d.meals.map((m) => (
                              <td key={m.mealId}>
                                {m.items ?? '—'}
                                {m.changed ? (
                                  <small className="ep-field__help" style={{ display: 'block' }}>
                                    {t(lang, 'Special')}
                                    {m.note ? `: ${m.note}` : ''}
                                  </small>
                                ) : null}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
              {rate.length ? (
                <Card title={t(lang, 'Rate the meals')} style={{ marginTop: 'var(--sp-4)' }}>
                  <p className="ep-field__help">
                    {t(
                      lang,
                      'How was the food? Rate the meals of the last three days (1 poor, 5 very good).',
                    )}
                  </p>
                  <ul className="fp-rcpts">
                    {rate.map((m) => (
                      <li key={`${m.mealId}-${m.onDate}`}>
                        <span>
                          <strong>{t(lang, m.meal)}</strong>{' '}
                          <span className="ep-field__help">
                            {dayName(m.onDate)} · {m.atTime}
                          </span>
                          {m.rating ? (
                            <span style={{ display: 'block' }}>
                              <Badge
                                tone={
                                  m.rating >= 4 ? 'success' : m.rating >= 3 ? 'warning' : 'danger'
                                }
                              >
                                {'★'.repeat(m.rating)}
                              </Badge>{' '}
                              {m.comment ? (
                                <span className="ep-field__help">{m.comment}</span>
                              ) : null}
                            </span>
                          ) : null}
                        </span>
                        <form
                          action={rateMeal}
                          style={{
                            display: 'flex',
                            gap: 'var(--sp-2)',
                            alignItems: 'center',
                            flexWrap: 'wrap',
                          }}
                        >
                          <input type="hidden" name="studentId" value={kid.id} />
                          <input type="hidden" name="mealId" value={m.mealId} />
                          <input type="hidden" name="onDate" value={m.onDate} />
                          <label className="ep-sr-only" htmlFor={`rt-${m.mealId}-${m.onDate}`}>
                            {t(lang, 'Rating')} · {m.meal} · {m.onDate}
                          </label>
                          <select
                            id={`rt-${m.mealId}-${m.onDate}`}
                            name="rating"
                            className="ep-select"
                            defaultValue={String(m.rating ?? 4)}
                          >
                            {[5, 4, 3, 2, 1].map((n) => (
                              <option key={n} value={n}>
                                {'★'.repeat(n)} {n}
                              </option>
                            ))}
                          </select>
                          <label className="ep-sr-only" htmlFor={`rc-${m.mealId}-${m.onDate}`}>
                            {t(lang, 'Comment')} · {m.meal}
                          </label>
                          <input
                            id={`rc-${m.mealId}-${m.onDate}`}
                            name="comment"
                            className="ep-input"
                            maxLength={500}
                            placeholder={t(lang, 'Comment (optional)')}
                            defaultValue={m.comment ?? ''}
                          />
                          <Button type="submit" size="sm" variant="secondary">
                            {m.rating ? t(lang, 'Change') : t(lang, 'Rate')}
                          </Button>
                        </form>
                      </li>
                    ))}
                  </ul>
                </Card>
              ) : null}
            </>
          ) : null}
          {tab === 'complaints' ? (
            <>
              <Card title={t(lang, 'Complaints')} style={{ marginTop: 'var(--sp-4)' }}>
                <p className="ep-field__help">
                  {t(
                    lang,
                    'Something wrong in your child’s room (a fan, water, furniture, cleaning, food)? Tell the warden here.',
                  )}
                </p>
                {complaints.length ? (
                  <ul className="fp-rcpts" style={{ marginBottom: 'var(--sp-3)' }}>
                    {complaints.map((c) => (
                      <li key={c.id}>
                        <span>
                          <strong>{c.subject}</strong>{' '}
                          <span className="ep-field__help">
                            {c.number} · {c.head} · {when(c.openedAt)}
                          </span>
                          {c.resolution ? (
                            <span className="ep-field__help" style={{ display: 'block' }}>
                              {t(lang, 'Resolution')}: {c.resolution}
                            </span>
                          ) : null}
                        </span>
                        <Badge tone={CSTATUS[c.status]?.[1] ?? 'neutral'}>
                          {t(lang, CSTATUS[c.status]?.[0] ?? c.status)}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <form action={raiseComplaint} style={{ display: 'grid', gap: 'var(--sp-3)' }}>
                  <input type="hidden" name="studentId" value={kid.id} />
                  <label className="ep-field" htmlFor="hc-head">
                    <span className="ep-field__label">{t(lang, 'About')} *</span>
                    <select id="hc-head" name="categoryCode" className="ep-select" required>
                      {heads.map((x) => (
                        <option key={x.code} value={x.code}>
                          {x.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="ep-field" htmlFor="hc-subj">
                    <span className="ep-field__label">{t(lang, 'Subject')} *</span>
                    <input
                      id="hc-subj"
                      name="subject"
                      className="ep-input"
                      required
                      minLength={3}
                      maxLength={200}
                    />
                  </label>
                  <label className="ep-field" htmlFor="hc-body">
                    <span className="ep-field__label">{t(lang, 'Details')} *</span>
                    <textarea
                      id="hc-body"
                      name="body"
                      className="ep-input"
                      rows={3}
                      required
                      minLength={3}
                      maxLength={2000}
                    />
                  </label>
                  <div>
                    <Button type="submit">{t(lang, 'Raise the complaint')}</Button>
                  </div>
                </form>
              </Card>
            </>
          ) : null}
          {tab === 'notes' ? (
            <>
              {incidents.length ? (
                <Card title={t(lang, 'From the hostel')} style={{ marginTop: 'var(--sp-4)' }}>
                  <ul className="fp-rcpts">
                    {incidents.map((i) => (
                      <li key={i.id}>
                        <span>
                          <strong>{t(lang, CATEGORY[i.category] ?? i.category)}</strong>{' '}
                          <span className="ep-field__help">{when(i.occurredAt)}</span>
                          <span style={{ display: 'block' }}>{i.what}</span>
                          {i.action ? (
                            <span className="ep-field__help" style={{ display: 'block' }}>
                              {t(lang, 'Action taken')}: {i.action}
                            </span>
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Card>
              ) : null}
            </>
          ) : null}
          {tab === 'leaving' ? (
            <>
              {exit ? (
                <Card title={t(lang, 'Leaving the hostel')} style={{ marginTop: 'var(--sp-4)' }}>
                  {exit.requests.length || exit.withdrawals.length ? (
                    <ul className="fp-rcpts" style={{ marginBottom: 'var(--sp-3)' }}>
                      {exit.requests.map((r) => (
                        <li key={`r-${r.id}`}>
                          <span>
                            <strong>
                              {t(lang, 'Request')} · {t(lang, 'last day')} {dayName(r.leavingOn)}
                            </strong>
                            {r.note ? <span className="ep-field__help"> · {r.note}</span> : null}
                            {r.status === 'declined' && r.declineNote ? (
                              <span className="ep-field__help" style={{ display: 'block' }}>
                                {t(lang, 'The hostel office replied')}: {r.declineNote}
                              </span>
                            ) : null}
                          </span>
                          <span
                            style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}
                          >
                            <Badge
                              tone={
                                r.status === 'pending'
                                  ? 'warning'
                                  : r.status === 'started'
                                    ? 'success'
                                    : 'neutral'
                              }
                            >
                              {t(
                                lang,
                                r.status === 'pending'
                                  ? 'Waiting for the office'
                                  : r.status === 'started'
                                    ? 'Started by the office'
                                    : r.status === 'declined'
                                      ? 'Not taken up'
                                      : 'Taken back',
                              )}
                            </Badge>
                            {r.status === 'pending' ? (
                              <form action={withdrawHostelExit}>
                                <input type="hidden" name="id" value={r.id} />
                                <input type="hidden" name="studentId" value={kid.id} />
                                <Button type="submit" size="sm" variant="ghost">
                                  {t(lang, 'Take back')}
                                </Button>
                              </form>
                            ) : null}
                          </span>
                        </li>
                      ))}
                      {exit.withdrawals.map((w) => (
                        <li key={`w-${w.id}`}>
                          <span>
                            <strong>
                              {t(lang, 'Hostel withdrawal')} · {t(lang, 'last day')}{' '}
                              {dayName(w.leavingOn)}
                            </strong>
                          </span>
                          <span
                            style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}
                          >
                            <Badge
                              tone={
                                w.status === 'completed'
                                  ? 'success'
                                  : w.status === 'requested'
                                    ? 'warning'
                                    : 'neutral'
                              }
                            >
                              {t(
                                lang,
                                w.status === 'completed'
                                  ? 'Left the hostel'
                                  : w.status === 'requested'
                                    ? 'Waiting for approval'
                                    : w.status === 'rejected'
                                      ? 'Not approved'
                                      : w.status === 'revoked'
                                        ? 'Revoked: back in the hostel'
                                        : 'Cancelled',
                              )}
                            </Badge>
                            {w.status === 'completed' ? (
                              <a
                                className="ep-btn ep-btn--secondary ep-btn--sm"
                                href={`/hostel/clearance/${w.id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                {t(lang, 'Clearance certificate')}
                              </a>
                            ) : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {exit.hostel &&
                  !exit.requests.some((r) => r.status === 'pending') &&
                  !exit.withdrawals.some((w) => w.status === 'requested') ? (
                    <form action={askHostelExit} className="hs-form" style={{ maxWidth: '36rem' }}>
                      <p className="ep-field__help" style={{ margin: 0 }}>
                        {t(
                          lang,
                          'Want your child to leave the hostel and stay in school as a day scholar? Ask here; the hostel office checks the room and the dues and starts it.',
                        )}
                      </p>
                      <input type="hidden" name="studentId" value={kid.id} />
                      <label className="ep-field" htmlFor="hx-day">
                        <span className="ep-field__label">{t(lang, 'Last day in the hostel')}</span>
                        <input
                          id="hx-day"
                          name="leavingOn"
                          type="date"
                          className="ep-input"
                          required
                          min={today}
                        />
                      </label>
                      <label className="ep-field" htmlFor="hx-why">
                        <span className="ep-field__label">{t(lang, 'Reason')}</span>
                        <select
                          id="hx-why"
                          name="reason"
                          className="ep-select"
                          defaultValue="parent_request"
                        >
                          <option value="parent_request">{t(lang, 'Our own reasons')}</option>
                          <option value="health">{t(lang, 'Health')}</option>
                          <option value="other">{t(lang, 'Other')}</option>
                        </select>
                      </label>
                      <label className="ep-field" htmlFor="hx-note">
                        <span className="ep-field__label">
                          {t(lang, 'Note for the hostel office')}
                        </span>
                        <textarea
                          id="hx-note"
                          name="note"
                          className="ep-input"
                          rows={2}
                          maxLength={1000}
                        />
                      </label>
                      <div>
                        <Button type="submit">{t(lang, 'Send the request')}</Button>
                      </div>
                    </form>
                  ) : null}
                </Card>
              ) : null}
            </>
          ) : null}
        </>
      )}
    </main>
  );
}
