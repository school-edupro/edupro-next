/** Single source of permission codes for this module; controllers and services import from here. */
export const PERMISSIONS = {
  view: 'academics.class.view',
  create: 'academics.class.create',
  edit: 'academics.class.edit',
  delete: 'academics.class.delete',
  sectionView: 'academics.class_section.view',
  sectionCreate: 'academics.class_section.create',
} as const;
