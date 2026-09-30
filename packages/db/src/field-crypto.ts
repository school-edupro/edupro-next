import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Field-level encryption for sensitive profile values (Aadhaar, PAN, bank account): AES-256-GCM with a
 * random 12-byte IV. Stored form: `v1:<base64(iv | tag | ciphertext)>`. The key comes from
 * FIELD_ENCRYPTION_KEY (32 bytes, base64). Production refuses to run without it; development derives a
 * stable key from SESSION_SECRET so local data stays readable across restarts.
 */
function key(): Buffer {
  const raw = process.env.FIELD_ENCRYPTION_KEY;
  if (raw) {
    const k = Buffer.from(raw, 'base64');
    if (k.length !== 32) throw new Error('FIELD_ENCRYPTION_KEY must be 32 bytes, base64 encoded');
    return k;
  }
  if (process.env.NODE_ENV === 'production')
    throw new Error('FIELD_ENCRYPTION_KEY is required in production');
  return createHash('sha256')
    .update(`edupro-dev-field-key:${process.env.SESSION_SECRET ?? 'local'}`)
    .digest();
}

export function encryptField(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `v1:${Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64')}`;
}

export function decryptField(stored: string): string | null {
  if (!stored.startsWith('v1:')) return null;
  try {
    const buf = Buffer.from(stored.slice(3), 'base64');
    const decipher = createDecipheriv('aes-256-gcm', key(), buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
  } catch {
    return null; // wrong key or tampered value: never throw from a read
  }
}

/** Shows only the last four characters: XXXX-XXXX-1234 for Aadhaar, XXXXXX234F style otherwise. */
export function maskValue(plain: string, type?: string): string {
  const last = plain.slice(-4);
  if (type === 'digits12' && plain.length === 12) return `XXXX-XXXX-${last}`;
  return `${'X'.repeat(Math.max(plain.length - 4, 2))}${last}`;
}
