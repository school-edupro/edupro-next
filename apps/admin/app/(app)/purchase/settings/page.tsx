import { Breadcrumbs, Button, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { PurchaseSettingsForm, type PlaceLists } from '@/components/purchase/PurchaseSettingsForm';
import { apiFetch, getMe } from '@/lib/api';
import type { DepartmentApprovals, PurchaseSettings } from '@/lib/purchase';
import {
  addCommitteeMember,
  addCondemnationMember,
  addVendorApprover,
  removeCommitteeMember,
  removeCondemnationMember,
  removeVendorApprover,
  saveCondemnationSignatures,
} from '@/lib/purchase-actions';

/**
 * Purchase settings (docs/design/83, part 1): the school's GSTIN and addresses, numbering, the sourcing
 * tiers (GFR 2017 limits by default), emergency purchase, the PO's validity, terms and signatures, the
 * department that approves combined PRs, the large-PO alert and the split window (every field checked,
 * the addresses from the school's masters); who approves vendors; and the purchase committee that
 * signs comparative statements.
 */
export default async function PurchaseSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('purchase.master.view')) notFound();
  const can = me.permissions.includes('purchase.settings.manage');
  const [s, a, cc, va, places] = await Promise.all([
    apiFetch<PurchaseSettings>('/purchase/settings'),
    apiFetch<DepartmentApprovals>('/purchase/approvals'),
    apiFetch<{
      signatures: number | null;
      members: Array<{
        id: string;
        employeeId: string;
        name: string;
        code: string;
        designation: string | null;
        role: string | null;
        signsIn: boolean;
      }>;
    }>('/purchase/condemnation-committee'),
    apiFetch<{
      mode: 'named' | 'role';
      named: Array<{
        id: string;
        employeeId: string;
        code: string;
        name: string;
        designation: string | null;
        signsIn: boolean;
      }>;
      roles: Array<{ code: string; name: string }>;
      people: Array<{ name: string; roles: string }>;
    }>('/purchase/vendor-approvers'),
    apiFetch<PlaceLists>('/purchase/vendors/form-lists'),
  ]);
  const approverIds = new Set(va.named.map((m) => m.employeeId));
  const canRoles = me.permissions.includes('access.role.view');
  const inCondemnation = new Set(cc.members.map((m) => m.employeeId));
  const inCommittee = new Set(s.committee.map((m) => m.employeeId));
  return (
    <>
      <Breadcrumbs
        items={[{ label: 'Purchase set-up', href: '/purchase' }, { label: 'Settings' }]}
      />
      <PageHeader
        kicker="Purchase"
        title="Purchase settings"
        description="Kept by the school admin. The sourcing limits start at the GFR 2017 figures; a private school may set its own."
      />
      <Notice params={sp} />
      <PurchaseSettingsForm
        s={s}
        departments={a.departments.map((d) => ({ id: d.id, name: d.name }))}
        places={places}
        can={can}
        committeeSize={s.committee.length}
      />

      <section
        id="vendor-approval"
        className="ep-card"
        aria-labelledby="ps-va"
        style={{ marginTop: 'var(--sp-5)' }}
      >
        <h2 id="ps-va" className="ep-card__title">
          Vendor approval · {va.mode === 'named' ? va.named.length : va.people.length}
        </h2>
        <p className="ep-field__help" style={{ marginTop: 0 }}>
          A new vendor, and a change of an approved vendor’s bank account, GSTIN or PAN, waits in{' '}
          <a href="/purchase/vendor-approvals">Vendor approvals</a>. Whoever entered or last changed
          it never approves it.{' '}
          {va.mode === 'named'
            ? 'Only the people named here approve vendors.'
            : `Nobody is named here, so whoever has the right “Approve a new vendor” approves (the roles ${va.roles.map((r) => r.name).join(', ') || 'none'}). Name people below and only they approve.`}
        </p>
        {va.mode === 'named' ? (
          <ul style={{ margin: 0, paddingLeft: 'var(--sp-5)' }}>
            {va.named.map((m) => (
              <li key={m.id} style={{ marginBottom: 'var(--sp-2)' }}>
                <strong>{m.name}</strong> ({m.code}){m.designation ? ` · ${m.designation}` : ''}
                {!m.signsIn ? (
                  <span className="ep-field__error"> · cannot sign in now</span>
                ) : null}{' '}
                {can ? (
                  <form action={removeVendorApprover} style={{ display: 'inline' }}>
                    <input type="hidden" name="id" value={m.id} />
                    <Button type="submit" variant="ghost" size="sm">
                      Remove
                    </Button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        ) : va.people.length ? (
          <>
            <p className="ep-field__help" style={{ margin: 0 }}>
              Who can approve now, by the right:
            </p>
            <ul style={{ margin: 0, paddingLeft: 'var(--sp-5)' }}>
              {va.people.map((x) => (
                <li key={x.name} style={{ marginBottom: 'var(--sp-1)' }}>
                  <strong>{x.name}</strong> · {x.roles}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="ep-alert ep-alert--warning" style={{ margin: 0 }}>
            Nobody can approve a vendor now, so new vendors cannot be used. Name an approver below.
          </p>
        )}
        {va.mode === 'named' && !va.named.some((m) => m.signsIn) ? (
          <p className="ep-alert ep-alert--warning" style={{ margin: 'var(--sp-2) 0 0' }}>
            None of the people named can sign in, so nobody can approve a vendor now.
          </p>
        ) : null}
        {can ? (
          <form
            action={addVendorApprover}
            className="ep-grid__toolbar"
            style={{ marginTop: 'var(--sp-3)' }}
          >
            <label className="ep-field" htmlFor="ps-va-emp">
              <span className="ep-field__label">Employee</span>
              <select
                id="ps-va-emp"
                name="employeeId"
                className="ep-select"
                required
                defaultValue=""
              >
                <option value="" disabled>
                  Pick an employee who signs in
                </option>
                {a.staff
                  .filter((x) => x.signsIn && !approverIds.has(x.id))
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name} ({x.code}){x.designation ? ` · ${x.designation}` : ''}
                    </option>
                  ))}
              </select>
            </label>
            <Button type="submit" variant="secondary" size="sm">
              Add as vendor approver
            </Button>
          </form>
        ) : null}
        {canRoles && va.mode === 'role' ? (
          <p className="ep-field__help" style={{ marginBottom: 0 }}>
            The right itself is given to roles in{' '}
            <a href="/access/roles" target="_blank" rel="noopener noreferrer">
              Access → Roles (opens a new tab)
            </a>
            .
          </p>
        ) : null}
      </section>

      <section
        id="committee"
        className="ep-card"
        aria-labelledby="ps-cm"
        style={{ marginTop: 'var(--sp-5)' }}
      >
        <h2 id="ps-cm" className="ep-card__title">
          Purchase committee · {s.committee.length}
        </h2>
        <p className="ep-field__help" style={{ marginTop: 0 }}>
          Signs the comparative statement of a PR between the direct and the committee limit.
        </p>
        {s.committee.length ? (
          <ul style={{ margin: 0, paddingLeft: 'var(--sp-5)' }}>
            {s.committee.map((m) => (
              <li key={m.id} style={{ marginBottom: 'var(--sp-2)' }}>
                <strong>{m.name}</strong> ({m.code}){m.designation ? ` · ${m.designation}` : ''}
                {m.role ? ` · ${m.role}` : ''}{' '}
                {can ? (
                  <form action={removeCommitteeMember} style={{ display: 'inline' }}>
                    <input type="hidden" name="id" value={m.id} />
                    <Button type="submit" variant="ghost" size="sm">
                      Remove
                    </Button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {can ? (
          <form
            action={addCommitteeMember}
            className="ep-grid__toolbar"
            style={{ marginTop: 'var(--sp-3)' }}
          >
            <label className="ep-field" htmlFor="ps-cm-emp">
              <span className="ep-field__label">Employee</span>
              <select
                id="ps-cm-emp"
                name="employeeId"
                className="ep-select"
                required
                defaultValue=""
              >
                <option value="" disabled>
                  Pick an employee
                </option>
                {a.staff
                  .filter((x) => !inCommittee.has(x.id))
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name} ({x.code}){x.designation ? ` · ${x.designation}` : ''}
                    </option>
                  ))}
              </select>
            </label>
            <label className="ep-field" htmlFor="ps-cm-role">
              <span className="ep-field__label">Role on the committee</span>
              <input
                id="ps-cm-role"
                name="role"
                className="ep-input"
                placeholder="Chair, member…"
                maxLength={60}
              />
            </label>
            <Button type="submit" variant="secondary" size="sm">
              Add to the committee
            </Button>
          </form>
        ) : null}
      </section>

      <section
        id="condemnation"
        className="ep-card"
        aria-labelledby="ps-cdn"
        style={{ marginTop: 'var(--sp-5)' }}
      >
        <h2 id="ps-cdn" className="ep-card__title">
          Condemnation committee · {cc.members.length}
        </h2>
        <p className="ep-field__help" style={{ marginTop: 0 }}>
          Recommends writing off unserviceable, obsolete or surplus assets and stock (GFR 2017 rule
          217) by signing the proposal; the school admin then approves it.
        </p>
        {cc.members.length ? (
          <ul style={{ margin: 0, paddingLeft: 'var(--sp-5)' }}>
            {cc.members.map((m) => (
              <li key={m.id} style={{ marginBottom: 'var(--sp-2)' }}>
                <strong>{m.name}</strong> ({m.code}){m.designation ? ` · ${m.designation}` : ''}
                {m.role ? ` · ${m.role}` : ''}
                {m.signsIn ? '' : ' · cannot sign in'}{' '}
                {can ? (
                  <form action={removeCondemnationMember} style={{ display: 'inline' }}>
                    <input type="hidden" name="id" value={m.id} />
                    <Button type="submit" variant="ghost" size="sm">
                      Remove
                    </Button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {can ? (
          <>
            <form
              action={addCondemnationMember}
              className="ep-grid__toolbar"
              style={{ marginTop: 'var(--sp-3)' }}
            >
              <label className="ep-field" htmlFor="ps-cd-emp">
                <span className="ep-field__label">Employee</span>
                <select
                  id="ps-cd-emp"
                  name="employeeId"
                  className="ep-select"
                  required
                  defaultValue=""
                >
                  <option value="" disabled>
                    Pick an employee
                  </option>
                  {a.staff
                    .filter((x) => !inCondemnation.has(x.id))
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name} ({x.code}){x.designation ? ` · ${x.designation}` : ''}
                      </option>
                    ))}
                </select>
              </label>
              <label className="ep-field" htmlFor="ps-cd-role">
                <span className="ep-field__label">Role on the committee</span>
                <input
                  id="ps-cd-role"
                  name="role"
                  className="ep-input"
                  placeholder="Chair, member…"
                  maxLength={60}
                />
              </label>
              <Button type="submit" variant="secondary" size="sm">
                Add to the committee
              </Button>
            </form>
            <form
              action={saveCondemnationSignatures}
              className="ep-grid__toolbar"
              style={{ marginTop: 'var(--sp-3)' }}
            >
              <label className="ep-field" htmlFor="ps-cd-sig">
                <span className="ep-field__label">Signatures needed</span>
                <input
                  id="ps-cd-sig"
                  name="signatures"
                  className="ep-input"
                  inputMode="numeric"
                  defaultValue={cc.signatures === null ? '' : String(cc.signatures)}
                  placeholder="Empty: every member"
                />
              </label>
              <Button type="submit" variant="secondary" size="sm">
                Save
              </Button>
            </form>
          </>
        ) : null}
      </section>
    </>
  );
}
