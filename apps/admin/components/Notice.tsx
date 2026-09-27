import { Alert } from '@edupro/ui';

const MESSAGES: Record<string, string> = {
  'permission-denied': 'You do not have permission for that action.',
  'mfa-required': 'This action needs a recent multi-factor sign-in.',
  'sod-conflict':
    'Refused: the user would hold two permissions that must stay separate (segregation of duties).',
  'validation-failed': 'Some values were not accepted.',
  conflict: 'That already exists.',
  'role.immutable':
    'System role templates cannot be edited. Copy the template into a school role instead.',
  'role.in_use': 'The role still has active assignments; revoke them first.',
  'user.not_member': 'The user is not an active member of this school.',
  'delegation.role_not_held': 'The giver does not currently hold that role.',
  'membership.self': 'You cannot deactivate your own membership.',
  'year.overlap': 'The dates overlap an existing year.',
  'year.not_planned': 'Only a planned year can be activated.',
  'year.active': 'Activate another year before closing this one.',
  'year.stage_locked': 'That stage of the year is locked.',
  'not-found': 'Not found.',
};

/** Reads ?ok=1 or ?error=<type>&detail=... written by server actions and renders the matching alert. */
export function Notice({ params }: { params: { ok?: string; error?: string; detail?: string } }) {
  if (params.ok) {
    return (
      <div style={{ marginBottom: 'var(--sp-4)' }}>
        <Alert tone="success">Saved.</Alert>
      </div>
    );
  }
  if (params.error) {
    const text = MESSAGES[params.error] ?? `The request failed (${params.error}).`;
    return (
      <div style={{ marginBottom: 'var(--sp-4)' }}>
        <Alert tone="danger" title={text}>
          {params.detail ? <span>{params.detail}</span> : null}
        </Alert>
      </div>
    );
  }
  return null;
}
