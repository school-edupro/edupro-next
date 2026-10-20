import Image from 'next/image';
import type { ReactNode } from 'react';
import type { SchoolProfile } from '@/lib/school';

const icon = (d: string) => (
  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path
      d={d}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
const PIN = icon(
  'M12 21s-7-5.6-7-11a7 7 0 1 1 14 0c0 5.4-7 11-7 11Zm0-8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
);
const PHONE = icon(
  'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.8 2Z',
);
const MAIL = icon(
  'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm18 2-10 7L2 6',
);
const GLOBE = icon(
  'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z',
);

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter((w) => /^[A-Za-z]/.test(w))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || name.slice(0, 1).toUpperCase();

/**
 * Every public page of a school carries the school (System → School profile): the logo and name, its
 * second line, board and affiliation at the top; the address, phone, email and website at the foot, so a
 * parent, a candidate or a visitor always sees whose page it is and how to reach the office.
 */
export function SchoolFrame({
  school,
  children,
}: {
  school: SchoolProfile | null;
  children: ReactNode;
}) {
  if (!school) return <main className="ep-pub-main">{children}</main>;
  const affiliation = [
    school.board,
    school.affiliationNo ? `affiliation no. ${school.affiliationNo}` : null,
  ]
    .filter(Boolean)
    .join(' ');
  const sub = [school.subtitle, affiliation].filter(Boolean).join(' · ');
  return (
    <>
      <header className="ep-pub-band">
        <a href={`/${school.code}`} className="ep-pub-band__home">
          {school.logo ? (
            <Image
              src={`/api/school-logo/${school.code}?v=${school.logo}`}
              alt=""
              width={360}
              height={120}
              sizes="12rem"
              priority
              className="ep-pub-band__logo"
            />
          ) : (
            <span className="ep-pub-band__mark" aria-hidden="true">
              {initials(school.name)}
            </span>
          )}
          <span className="ep-pub-band__text">
            <span className="ep-pub-band__name">{school.name}</span>
            {sub ? <span className="ep-pub-band__sub">{sub}</span> : null}
          </span>
        </a>
      </header>
      <main className="ep-pub-main">{children}</main>
      <footer className="ep-pub-foot">
        <div className="ep-pub-foot__in">
          <strong className="ep-pub-foot__name">{school.name}</strong>
          {school.address ? (
            <span className="ep-pub-foot__item">
              {PIN}
              {school.address}
            </span>
          ) : null}
          <span className="ep-pub-foot__links">
            {school.phone ? (
              <a className="ep-pub-foot__item" href={`tel:${school.phone.replace(/[^\d+]/g, '')}`}>
                {PHONE}
                {school.phone}
              </a>
            ) : null}
            {school.email ? (
              <a className="ep-pub-foot__item" href={`mailto:${school.email}`}>
                {MAIL}
                {school.email}
              </a>
            ) : null}
            {school.website ? (
              <a
                className="ep-pub-foot__item"
                href={school.website}
                target="_blank"
                rel="noopener noreferrer"
              >
                {GLOBE}
                {school.website.replace(/^https?:\/\//i, '').replace(/\/$/, '')}
              </a>
            ) : null}
          </span>
        </div>
      </footer>
    </>
  );
}
