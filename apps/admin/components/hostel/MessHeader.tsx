import { PageHeader } from '@edupro/ui';
import { HostelNav } from '@/components/hostel/HostelNav';
import { Notice } from '@/components/Notice';

export const MESS_TABS = [
  ['', 'This week'],
  ['menu', 'Menu cycle'],
  ['attendance', 'Meal attendance'],
  ['register', 'Meal register'],
  ['headcount', 'Kitchen head count'],
  ['diets', 'Diet list'],
  ['feedback', 'Feedback'],
  ['setup', 'Set-up'],
] as const;
export type MessTab = (typeof MESS_TABS)[number][0];

/** The mess pages: one header, the hostel tabs, the mess tabs (keeping the hostel chosen) and the notice. */
export function MessHeader({
  current,
  permissions,
  hostelId,
  sp,
  description,
  actions,
}: {
  current: MessTab;
  permissions: string[];
  hostelId?: string;
  sp: { ok?: string; error?: string; detail?: string };
  description: string;
  actions?: React.ReactNode;
}) {
  const manage = permissions.includes('hostel.mess.manage');
  const tabs = MESS_TABS.filter(
    ([k]) =>
      manage ||
      k === '' ||
      k === 'menu' ||
      (k === 'setup' && permissions.includes('hostel.setup.manage')),
  );
  return (
    <>
      <PageHeader kicker="Hostel · Mess" title="Mess" description={description} actions={actions} />
      <HostelNav current="/hostel/mess" permissions={permissions} />
      <nav className="ep-tabs-links" aria-label="Mess" style={{ marginBottom: 'var(--sp-4)' }}>
        {tabs.map(([k, label]) => (
          <a
            key={k}
            href={`/hostel/mess${k ? `/${k}` : ''}${hostelId ? `?hostel=${hostelId}` : ''}`}
            aria-current={k === current ? 'page' : undefined}
          >
            {label}
          </a>
        ))}
      </nav>
      <Notice params={sp} />
    </>
  );
}

/** The hostel picker of a mess page (a GET form keeping the other filters). */
export function HostelPicker({
  hostels,
  hostelId,
  keep = {},
  children,
}: {
  hostels: Array<{ id: string; name: string }>;
  hostelId: string;
  keep?: Record<string, string>;
  children?: React.ReactNode;
}) {
  return (
    <div className="ep-filter-band" style={{ marginBottom: 'var(--sp-4)' }}>
      <form method="get" className="ep-dlog__filters">
        {Object.entries(keep).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <label className="ep-field" htmlFor="mh-hostel">
          <span className="ep-field__label">Hostel</span>
          <select id="mh-hostel" name="hostel" className="ep-select" defaultValue={hostelId}>
            {hostels.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </label>
        {children}
        <button type="submit" className="ep-btn ep-btn--secondary">
          Show
        </button>
      </form>
    </div>
  );
}
