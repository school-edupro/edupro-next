import { ViewAsBar } from '@edupro/ui';
import { bff } from '@/lib/bff';

/** The bar shown while the school has this portal open as the person (0183). */
export async function ViewAs() {
  const s = await bff.session.read();
  if (!s?.viewAs) return null;
  const me = await bff.api.me().catch(() => null);
  const imp = me?.impersonation;
  if (!me || !imp) return null;
  return (
    <ViewAsBar
      name={me.user.displayName}
      by={imp.byDisplayName}
      until={imp.expiresAt}
      mode={imp.mode}
    />
  );
}
