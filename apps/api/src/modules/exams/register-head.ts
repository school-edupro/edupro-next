import type { PoolClient } from '@edupro/db';
import type { StorageDriver } from '@edupro/storage';
import type { RegisterFileMeta } from './mark-register-file';

/** The school's head for a register's paper: its name, address and the logo file (if any). */
export async function registerLetterhead(c: PoolClient) {
  const sc = await c.query<{
    name: string;
    logo: string | null;
    address: Record<string, string> | null;
  }>(
    `SELECT name, NULLIF(branding->>'logoFileId', '') AS logo, address FROM schools WHERE id = app.current_school_id()`,
  );
  const s = sc.rows[0];
  const logoId = s?.logo;
  const f =
    logoId && /^\d{1,18}$/.test(logoId)
      ? (
          await c.query<{ object_key: string; content_type: string }>(
            `SELECT object_key, content_type FROM files WHERE id = $1 AND deleted_at IS NULL`,
            [logoId],
          )
        ).rows[0]
      : undefined;
  const a = s?.address ?? {};
  return {
    school: s?.name ?? '',
    address: [a.line1, a.line2, a.city, a.state, a.pincode].filter(Boolean).join(', '),
    file: f,
  };
}

/** The logo's bytes for the paper; none when it cannot be read. */
export async function registerLogo(
  storage: StorageDriver,
  file: { object_key: string; content_type: string } | undefined,
): Promise<RegisterFileMeta['logo']> {
  if (!file) return null;
  try {
    return { contentType: file.content_type, bytes: await storage.read(file.object_key) };
  } catch {
    return null;
  }
}

/** When a paper was made, as the old reports print it: 31-10-2026 08:08 PM (India). */
export function registerGeneratedOn() {
  return new Date()
    .toLocaleString('en-GB', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    })
    .replace(/\//g, '-')
    .replace(',', '')
    .toUpperCase();
}
