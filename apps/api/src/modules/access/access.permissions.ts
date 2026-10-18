/** Permission codes owned by the access module. */
export const ACCESS = {
  roleView: 'access.role.view',
  roleManage: 'access.role.manage',
  assignmentView: 'access.assignment.view',
  assignmentManage: 'access.assignment.manage',
  delegationCreate: 'access.delegation.create',
  delegationManage: 'access.delegation.manage',
  membershipManage: 'access.membership.manage',
  userSearch: 'access.user.search',
  impersonate: 'access.session.impersonate',
  portalViewAs: 'access.portal.view_as',
  portalActAs: 'access.portal.act_as',
} as const;
