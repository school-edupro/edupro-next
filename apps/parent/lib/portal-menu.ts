import type { Me } from '@edupro/bff';
import { familyCanOpen } from '@edupro/menus';

/** May this family member open the screen? (the rights each screen needs live in @edupro/menus) */
export function canOpen(me: Me, href: string): boolean {
  return familyCanOpen(me.permissions, href);
}
