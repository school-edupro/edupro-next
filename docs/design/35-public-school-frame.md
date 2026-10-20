# 35 · A school's public pages carry the school

Built 20 Oct 2026. Every public page of a school (`apps/public/app/[school]/…`: admissions and the
application, admission status, appointments, the visitor's own registration, gate and visitor passes,
consent forms, careers and the application form) is drawn inside the school's frame, so a parent, a
candidate or a visitor always sees whose page it is and how to reach the office.

- **Source:** System → School profile. `GET public/schools/:code` (public, read-only, throttled) gives the
  name, the second line (`branding.name2`, shown when it says more than the name), board and affiliation
  number, the address in one line, the general phone, email and website (with `https://` when typed
  without), and the logo's file id. The office's own addresses in the contact (accounts, principal,
  transport…) are not given out. `GET public/schools/:code/logo` gives the logo, raster images only (an
  SVG could carry script onto the public site); 404 for an unknown school or no logo.
- **The frame** (`app/[school]/layout.tsx`, `components/SchoolFrame.tsx`): a band at the top with the logo
  (or the school's initials) and name linking to the school's home page, and the second line, board and
  affiliation under it (`banner`); the page in `main`; at the foot the name, address, and phone, email and
  website as links (`contentinfo`). The browser tab reads "<page> · <school>". The profile is kept for
  five minutes; the logo goes through `next/image` (`/api/school-logo/:school?v=<file id>`, resized: a
  1.1 MB logo arrives as about 6 KB) and is cached a day under its file id, so a new logo shows at once.
- The pages' own small headings now say what the page is (Admissions, Book a meeting, Visitor, At the
  gate, Consent form, Jobs at the school) instead of repeating the school's code or name.
- The site's home page (the list of schools) keeps its own plain frame.
- Tests: `recruitment-public.e2e-spec.ts` (the profile, what stays inside, no logo); `public-a11y.spec.ts`
  ("every public page carries the school": banner and footer with the name, `main`, the tab title, on
  seven pages; and the accessibility checks of the pages in the frame).
