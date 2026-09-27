import { bff } from '@/lib/bff';

export const middleware = bff.middleware();

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
