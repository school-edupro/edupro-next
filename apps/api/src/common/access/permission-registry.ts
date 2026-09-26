import type { PermissionRequirement } from './require-permission.decorator';

/**
 * Process-wide catalogue of permissions declared in code. Filled by @RequirePermission() as modules load,
 * synchronised into the permissions table by AccessService on bootstrap, served by GET /access/permissions.
 */
export class PermissionRegistry {
  private static readonly items = new Map<string, PermissionRequirement>();

  static register(req: PermissionRequirement): void {
    const existing = this.items.get(req.code);
    if (existing) {
      // Same code declared on several handlers is normal (list and export may share a view permission).
      if (req.mfa && !existing.mfa) existing.mfa = true;
      if (req.description && !existing.description) existing.description = req.description;
      return;
    }
    this.items.set(req.code, { ...req });
  }

  static all(): PermissionRequirement[] {
    return [...this.items.values()].sort((a, b) => a.code.localeCompare(b.code));
  }

  static has(code: string): boolean {
    return this.items.has(code);
  }

  static moduleOf(code: string): string {
    return code.split('.')[0] ?? code;
  }
}
