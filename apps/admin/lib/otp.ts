import { createOtp } from '@edupro/bff';
import { env } from './env';
import { key, writeSession } from './session';
import { recordSignIn } from './sign-in';

/** Sign-in with a code by email (0136), on the admin app's own session cookie ("edupro_session"). */
export const otp = createOtp({
  cookie: 'edupro',
  app: 'admin',
  apiBaseUrl: () => env.apiBaseUrl,
  sessionKey: key,
  writeSession: (s) => writeSession(s),
  recordSignIn: (req, token) => recordSignIn(req, token, 'otp'),
});
