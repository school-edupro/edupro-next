import { ApiError } from '@edupro/bff';
import { bff } from './bff';

/**
 * The admin app's API helpers as the staff website has them, so the register pages and download routes shared with
 * the admin (docs/design/97) read the same.
 */
export { ApiError };
export const apiFetch = <T>(path: string, init?: RequestInit): Promise<T> =>
  bff.api.fetch<T>(path, init);
export const getMe = () => bff.api.me();
