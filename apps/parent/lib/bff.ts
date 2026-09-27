import { createBff } from '@edupro/bff';

/** Cookie names are per app so the parent and teacher shells can coexist on one device. */
export const bff = createBff({ cookie: 'edupro_parent' });
