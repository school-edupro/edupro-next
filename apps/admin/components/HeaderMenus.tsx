import type { Me } from '@/lib/api';
import { Icon } from './nav-icons';

type T = (key: string, values?: Record<string, string | number>) => string;

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

/**
 * The school and year in one chip; its menu lists the user's schools and the school's years, and a pick
 * switches at once (each choice posts to /api/context, so it works without scripts).
 */
export function ContextMenu({ me, t }: { me: Me; t: T }) {
  const years = me.academicYears ?? [];
  const school =
    me.memberships.find((m) => m.schoolId === me.school?.id)?.schoolName ??
    me.memberships[0]?.schoolName ??
    'EduPro Next';
  const year = years.find((y) => y.id === me.academicYear?.id) ?? null;
  const several = me.memberships.length > 1;
  if (!several && years.length <= 1)
    return (
      <span className="ep-hchip ep-hchip--static" title={school}>
        <Icon name="school" size={18} />
        <span className="ep-hchip__school">{school}</span>
        {year ? <span className="ep-hchip__year">{year.code}</span> : null}
      </span>
    );
  return (
    <details className="ep-hmenu ep-hmenu--left">
      <summary
        className="ep-hchip"
        title={t('switchContext')}
        aria-label={`${t('switchContext')}: ${school}${year ? `, ${year.code}` : ''}`}
      >
        <Icon name="school" size={18} />
        <span className="ep-hchip__school">{school}</span>
        {year ? (
          <span className="ep-hchip__year">
            {year.code}
            {year.status !== 'active' ? (
              <span className="ep-hchip__status"> · {year.status}</span>
            ) : null}
          </span>
        ) : null}
        <Icon name="chevron" size={16} />
      </summary>
      <div className="ep-hmenu__panel">
        {several ? (
          <>
            <p className="ep-hmenu__heading">{t('schoolHeading')}</p>
            <ul className="ep-hmenu__list">
              {me.memberships.map((m) => (
                <li key={m.schoolId}>
                  <form method="post" action="/api/context">
                    <input type="hidden" name="schoolId" value={m.schoolId} />
                    <button
                      type="submit"
                      className="ep-hmenu__item"
                      aria-current={m.schoolId === me.school?.id ? 'true' : undefined}
                    >
                      <span>{m.schoolName}</span>
                      {m.schoolId === me.school?.id ? <Icon name="check" size={16} /> : null}
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {years.length ? (
          <>
            <p className="ep-hmenu__heading">{t('yearHeading')}</p>
            <ul className="ep-hmenu__list">
              {years.map((y) => (
                <li key={y.id}>
                  <form method="post" action="/api/context">
                    {me.school?.id ? (
                      <input type="hidden" name="schoolId" value={me.school.id} />
                    ) : null}
                    <input type="hidden" name="academicYearId" value={y.id} />
                    <button
                      type="submit"
                      className="ep-hmenu__item"
                      aria-current={y.id === year?.id ? 'true' : undefined}
                    >
                      <span>
                        {y.code}
                        <span className={`ep-hmenu__tag ep-hmenu__tag--${y.status}`}>
                          {y.status}
                        </span>
                      </span>
                      {y.id === year?.id ? <Icon name="check" size={16} /> : null}
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </details>
  );
}

/** English or Hindi: a pick changes the language at once. */
export function LanguageMenu({ locale, t }: { locale: string; t: T }) {
  const LANGS = [
    ['en', 'English'],
    ['hi', 'हिन्दी'],
  ] as const;
  return (
    <details className="ep-hmenu">
      <summary
        className="ep-header__icon-btn"
        aria-label={`${t('language')}: ${LANGS.find(([v]) => v === locale)?.[1] ?? 'English'}`}
        title={t('language')}
      >
        <Icon name="globe" size={21} />
      </summary>
      <div className="ep-hmenu__panel ep-hmenu__panel--narrow">
        <p className="ep-hmenu__heading">{t('language')}</p>
        <ul className="ep-hmenu__list">
          {LANGS.map(([v, label]) => (
            <li key={v}>
              <form method="post" action="/api/locale">
                <input type="hidden" name="locale" value={v} />
                <button
                  type="submit"
                  className="ep-hmenu__item"
                  lang={v}
                  aria-current={locale === v ? 'true' : undefined}
                >
                  <span>{label}</span>
                  {locale === v ? <Icon name="check" size={16} /> : null}
                </button>
              </form>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

export interface AccountCard {
  name: string;
  roles: string[];
  designation: string | null;
  school: string | null;
  academicYear: string | null;
  mobile: string | null;
  email: string | null;
  thisLogin: { at: string; device: string | null; app: string | null } | null;
  lastLogin: { at: string; device: string | null; app: string | null } | null;
}

/**
 * The signed-in person: initials, name and role in the header; the menu has who they are, where they
 * sign in from, My profile and Security, and Sign out.
 */
export function AccountMenu({
  me,
  card,
  school,
  isStaff,
  roleLabel,
  t,
  at,
}: {
  me: Me;
  card: AccountCard | null;
  school: string;
  isStaff: boolean;
  roleLabel: string;
  t: T;
  at: (iso: string) => string;
}) {
  const name = card?.name ?? me.user.displayName;
  const facts: Array<[string, string]> = [
    [t('role'), card?.roles.length ? card.roles.join(', ') : '—'],
    [
      t('schoolHeading'),
      `${card?.school ?? school}${card?.academicYear ? ` · ${card.academicYear}` : ''}`,
    ],
    ...(card?.mobile ? ([[t('mobile'), card.mobile]] as Array<[string, string]>) : []),
    ...(card?.email ? ([[t('email'), card.email]] as Array<[string, string]>) : []),
    [
      t('lastSignIn'),
      card?.lastLogin
        ? `${at(card.lastLogin.at)}${card.lastLogin.device ? ` · ${card.lastLogin.device}` : ''}`
        : t('firstSignIn'),
    ],
    ...(card?.thisLogin
      ? ([
          [
            t('signedInNow'),
            `${at(card.thisLogin.at)}${card.thisLogin.device ? ` · ${card.thisLogin.device}` : ''}`,
          ],
        ] as Array<[string, string]>)
      : []),
  ];
  return (
    <details className="ep-hmenu">
      <summary className="ep-haccount" aria-label={`${t('account')}: ${name}`} title={t('account')}>
        <span className="ep-haccount__avatar" aria-hidden="true">
          {initials(name)}
        </span>
        <span className="ep-haccount__text">
          <span className="ep-haccount__name">{name}</span>
          <span className="ep-haccount__role">{roleLabel}</span>
        </span>
        <Icon name="chevron" size={16} />
      </summary>
      <div className="ep-hmenu__panel">
        <div className="ep-haccount__head">
          <span className="ep-haccount__avatar ep-haccount__avatar--lg" aria-hidden="true">
            {initials(name)}
          </span>
          <span>
            <span className="ep-hmenu__title">{name}</span>
            {card?.designation ? <span className="ep-hmenu__muted">{card.designation}</span> : null}
          </span>
        </div>
        <dl className="ep-usercard__facts">
          {facts.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <ul className="ep-hmenu__list ep-hmenu__list--rule">
          {isStaff ? (
            <li>
              <a className="ep-hmenu__item" href="/me/profile">
                <span>{t('myProfile')}</span>
                <Icon name="user" size={16} />
              </a>
            </li>
          ) : null}
          <li>
            <a className="ep-hmenu__item" href="/system/security">
              <span>{t('security')}</span>
              <Icon name="lock" size={16} />
            </a>
          </li>
          <li>
            <form method="post" action="/api/auth/logout">
              <button type="submit" className="ep-hmenu__item ep-hmenu__item--danger">
                <span>{t('signOut')}</span>
                <Icon name="logout" size={16} />
              </button>
            </form>
          </li>
        </ul>
      </div>
    </details>
  );
}
