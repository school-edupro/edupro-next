import type { PoolClient } from '@edupro/db';
import type { StorageDriver } from '@edupro/storage';
import type { LetterheadLogo } from '../../common/pdf/letterhead';
import { registerGeneratedOn, registerLetterhead, registerLogo } from '../exams/register-head';

/**
 * What a purchase paper's letterhead needs: the school's name, its full address (line 1, line 2, city,
 * state, PIN), the logo's bytes and when the paper is made ("07-11-2026 06:15 PM", India).
 */
export async function purchaseHead(
  c: PoolClient,
  storage: StorageDriver,
): Promise<{ school: string; address: string; logo: LetterheadLogo | null; generatedOn: string }> {
  const h = await registerLetterhead(c);
  return {
    school: h.school,
    address: h.address,
    logo: await registerLogo(storage, h.file),
    generatedOn: registerGeneratedOn(),
  };
}
