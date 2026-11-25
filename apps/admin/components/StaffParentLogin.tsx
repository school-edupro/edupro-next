import { Badge, Button, type BadgeTone } from '@edupro/ui';
import { ConfirmAction } from '@/components/ConfirmAction';
import { staffParentJoin, staffParentUndo } from '@/lib/actions';
import type { StaffParentLink, StaffParentState } from '@/lib/types';

const SHOWN: Record<StaffParentState, { label: string; tone: BadgeTone }> = {
  joined: { label: 'Joined to staff login', tone: 'success' },
  ready: { label: 'Not joined yet', tone: 'warning' },
  separate_login: { label: 'Has its own login', tone: 'warning' },
  staff_no_login: { label: 'Staff member has no login', tone: 'neutral' },
  no_employee: { label: 'No staff member with this code', tone: 'danger' },
  no_code: { label: 'No employee code', tone: 'danger' },
};

/** What the office can do next, in a line under the badge. */
const HINT: Partial<Record<StaffParentState, string>> = {
  joined: 'One login: the staff member switches between Staff and Parent in the app.',
  staff_no_login: 'Joins by itself when the staff member gets a login.',
  no_employee: 'Check the employee code in the parent section of the full profile.',
  no_code: 'Enter the staff employee code in the parent section of the full profile.',
};

/**
 * A parent record marked "School staff: Yes": where it stands with the staff member's login, and the step — Join
 * (no login of its own), Use staff login (its own login stops seeing the children; asks first), Undo.
 */
export function StaffParentLogin({
  guardianId,
  link,
  relation,
  canEdit,
  back,
}: {
  guardianId: string;
  link: StaffParentLink;
  /** father, mother, guardian … for the words in the dialog */
  relation: string;
  canEdit: boolean;
  /** the page to come back to */
  back: string;
}) {
  const shown = SHOWN[link.state];
  const staff = link.employee ? `${link.employee.name} (${link.employee.code})` : (link.code ?? '');
  const fields = { guardianId, back };
  return (
    <div style={{ display: 'grid', gap: 'var(--sp-1)', justifyItems: 'start' }}>
      <span>
        <Badge tone={shown.tone}>{shown.label}</Badge>
        {staff ? <span className="ep-field__help"> {staff}</span> : null}
      </span>
      {HINT[link.state] ? <span className="ep-field__help">{HINT[link.state]}</span> : null}
      {canEdit && link.state === 'ready' ? (
        <form action={staffParentJoin}>
          <input type="hidden" name="guardianId" value={guardianId} />
          <input type="hidden" name="back" value={back} />
          <Button type="submit" size="sm" variant="secondary">
            Join to staff login
          </Button>
        </form>
      ) : null}
      {canEdit && link.state === 'separate_login' ? (
        <ConfirmAction
          action={staffParentJoin}
          fields={{ ...fields, move: '1' }}
          label="Use staff login"
          title={`Use the staff login of ${staff}?`}
          confirmLabel="Use staff login"
        >
          <p style={{ marginTop: 0 }}>
            This {relation}&apos;s record has a login of its own. After this, the staff member sees
            this record&apos;s children in their own app and on the family website, with one
            sign-in.
          </p>
          <p>
            The record&apos;s own login stops seeing these children. If someone else in the family
            uses it, give them their own login (for example the other parent&apos;s record). Undo
            puts it back.
          </p>
        </ConfirmAction>
      ) : null}
      {canEdit && link.state === 'joined' && link.canUndo ? (
        <ConfirmAction
          action={staffParentUndo}
          fields={fields}
          label="Undo"
          variant="ghost"
          title="Undo the join to the staff login?"
          confirmLabel="Undo"
        >
          <p style={{ marginTop: 0 }}>
            The staff member stops seeing this record&apos;s children in their app. The login the
            record had before (if any) comes back. If this parent is not on the staff, also set
            School staff to No in the full profile.
          </p>
        </ConfirmAction>
      ) : null}
    </div>
  );
}
