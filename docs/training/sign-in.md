# Sign-in with a code by email (October 2026)

**System → Sign-in** (school admin, *platform.settings.edit*) decides how the school's staff, teachers
and parents sign in. Developer sign-in is not affected.

| Choice | What the user does |
|---|---|
| **One Auth only** (default) | Continue with One Auth, as before. |
| **One Auth, then a code by email** | After One Auth, a 6-digit code is mailed; the user types it. Two steps: the safest. |
| **A code by email alone** | On the sign-in page, *Sign in with a code by email*: the email or mobile number, then the code. One Auth still works and also asks the code. |

- The code goes **on every channel at once**: a formatted email from the school's email, the school's
  approved WhatsApp template (e.g. `otp_verifcation`, the code as its variable) and the DLT SMS template
  (e.g. 1207163922745202205); pick them on the Sign-in page or leave "Find the OTP template by itself".
  Sent by the background workers; it works **once, for 10 minutes**. One new code every 30 seconds, five in 15 minutes, five tries a code.
- **Also show the code on screen**: for the rollout, while emails are being corrected. Anyone at the
  sign-in screen can then sign in as that user, so switch it off once emails are fixed. Every code
  shown on screen is listed on the same page (when, who, app, IP address).
- **Users without a valid email** are listed on the page: correct them in People before switching the
  on-screen code off; without it they cannot sign in by code.
- **Remember this device for 30 days**: ticked on the code screen, that browser skips the code for the
  same app. *Forget all remembered devices* on the settings page ends it for everyone (a lost laptop).
- A user of several schools follows the strictest: a code is asked when any of the schools asks it; the
  code alone works only when every school allows it. A change applies within a minute.
- An unknown email or mobile gets the same answer as a known one ("if this account can sign in with a
  code…"), so the page does not tell outsiders who has an account.
- Production needs **OTP_JWT_SECRET** (32+ characters) set for the API.
