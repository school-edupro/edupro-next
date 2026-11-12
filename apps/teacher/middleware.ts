import { bff } from '@/lib/bff';
import { pageCsp } from './csp';

// pages get the Content Security Policy with a nonce per request (production builds)
export const middleware = bff.middleware([], { page: pageCsp });

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
