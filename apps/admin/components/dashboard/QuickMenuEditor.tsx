'use client';
import { useId, useState } from 'react';
import { Icon, type IconName } from '@/components/nav-icons';

export interface MenuPage {
  href: string;
  label: string;
  sectionLabel: string;
  icon: IconName;
}
interface Item {
  href: string;
  label?: string;
  icon?: string;
}

const MAX = 24;

/**
 * The quick menu of a role, in order: add a page of the menu (type to search) or a link of the school
 * outside EduPro (https), rename a tile, change its icon, move it up or down, remove it. Posted as JSON
 * in `quick`.
 */
export function QuickMenuEditor({
  initial,
  pages,
  icons,
}: {
  initial: Item[];
  pages: MenuPage[];
  icons: IconName[];
}) {
  const id = useId();
  const [items, setItems] = useState<Item[]>(initial);
  const [pick, setPick] = useState('');
  const [link, setLink] = useState({ label: '', href: '', icon: 'link' });
  const [error, setError] = useState<string | null>(null);
  const byHref = new Map(pages.map((p) => [p.href, p]));
  const pageText = (p: MenuPage) => `${p.label} · ${p.sectionLabel}`;
  const update = (i: number, patch: Partial<Item>) =>
    setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const move = (i: number, d: -1 | 1) =>
    setItems((xs) => {
      const j = i + d;
      if (j < 0 || j >= xs.length) return xs;
      const n = [...xs];
      [n[i], n[j]] = [n[j]!, n[i]!];
      return n;
    });
  const add = (it: Item) => {
    if (items.length >= MAX) return setError(`Up to ${String(MAX)} quick actions.`);
    if (items.some((x) => x.href === it.href)) return setError('That one is already in the menu.');
    setError(null);
    setItems((xs) => [...xs, it]);
  };
  const addPage = () => {
    const p = pages.find((x) => pageText(x) === pick.trim() || x.href === pick.trim());
    if (!p) return setError('Pick a page from the list.');
    add({ href: p.href });
    setPick('');
  };
  const addLink = () => {
    if (link.label.trim().length < 2) return setError('Give the link a name.');
    if (!/^https:\/\/[^\s"'<>]+$/.test(link.href.trim()))
      return setError('A link must start with https://');
    add({ href: link.href.trim(), label: link.label.trim(), icon: link.icon });
    setLink({ label: '', href: '', icon: 'link' });
  };
  return (
    <div className="db-qm">
      <input type="hidden" name="quick" value={JSON.stringify(items)} />
      {items.length ? (
        <ol className="db-qm__list">
          {items.map((it, i) => {
            const page = byHref.get(it.href);
            const outside = it.href.startsWith('https://');
            const name = it.label || page?.label || it.href;
            return (
              <li key={it.href} className="db-qm__row">
                <span className="db-qm__icon" aria-hidden="true">
                  <Icon
                    name={(icons.includes(it.icon as IconName) ? it.icon : page?.icon) as IconName}
                    size={18}
                  />
                </span>
                <span className="db-qm__what">
                  <label className="ep-sr-only" htmlFor={`${id}-l-${String(i)}`}>
                    Name of {name}
                  </label>
                  <input
                    id={`${id}-l-${String(i)}`}
                    className="ep-input"
                    value={it.label ?? ''}
                    placeholder={page?.label ?? 'Name'}
                    maxLength={40}
                    required={outside}
                    onChange={(e) => update(i, { label: e.target.value })}
                  />
                  <span className="db-muted">
                    {outside ? `School link · ${it.href}` : (page?.sectionLabel ?? it.href)}
                  </span>
                </span>
                <label className="ep-sr-only" htmlFor={`${id}-i-${String(i)}`}>
                  Icon of {name}
                </label>
                <select
                  id={`${id}-i-${String(i)}`}
                  className="ep-select db-qm__iconpick"
                  value={it.icon ?? ''}
                  onChange={(e) => update(i, { icon: e.target.value || undefined })}
                >
                  <option value="">{outside ? 'link' : 'Menu icon'}</option>
                  {icons.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
                <span className="db-qm__btns">
                  <button
                    type="button"
                    className="ep-btn ep-btn--ghost ep-btn--sm"
                    onClick={() => move(i, -1)}
                    disabled={i === 0}
                    aria-label={`Move ${name} up`}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="ep-btn ep-btn--ghost ep-btn--sm"
                    onClick={() => move(i, 1)}
                    disabled={i === items.length - 1}
                    aria-label={`Move ${name} down`}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="ep-btn ep-btn--ghost ep-btn--sm"
                    onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))}
                    aria-label={`Remove ${name}`}
                  >
                    Remove
                  </button>
                </span>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="db-empty">
          No quick action set: each person sees the first eight pages of their menu.
        </p>
      )}
      {error ? (
        <p className="ep-field__error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="db-qm__add">
        <div className="ep-field">
          <label className="ep-field__label" htmlFor={`${id}-page`}>
            Add a page of the menu
          </label>
          <div className="db-qm__inline">
            <input
              id={`${id}-page`}
              className="ep-input"
              list={`${id}-pages`}
              value={pick}
              onChange={(e) => setPick(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addPage();
                }
              }}
              placeholder="Type to search: fee, visitor, roll…"
            />
            <datalist id={`${id}-pages`}>
              {pages
                .filter((p) => !items.some((x) => x.href === p.href))
                .map((p) => (
                  <option key={p.href} value={pageText(p)} />
                ))}
            </datalist>
            <button type="button" className="ep-btn ep-btn--secondary ep-btn--sm" onClick={addPage}>
              Add page
            </button>
          </div>
        </div>
        <fieldset className="db-arrange__set">
          <legend className="ep-field__label">Add a link of the school (outside EduPro)</legend>
          <div className="db-qm__inline">
            <label className="ep-sr-only" htmlFor={`${id}-ln`}>
              Link name
            </label>
            <input
              id={`${id}-ln`}
              className="ep-input"
              placeholder="Name, e.g. School website"
              maxLength={40}
              value={link.label}
              onChange={(e) => setLink({ ...link, label: e.target.value })}
            />
            <label className="ep-sr-only" htmlFor={`${id}-lh`}>
              Link address
            </label>
            <input
              id={`${id}-lh`}
              className="ep-input"
              type="url"
              placeholder="https://"
              value={link.href}
              onChange={(e) => setLink({ ...link, href: e.target.value })}
            />
            <label className="ep-sr-only" htmlFor={`${id}-li`}>
              Link icon
            </label>
            <select
              id={`${id}-li`}
              className="ep-select db-qm__iconpick"
              value={link.icon}
              onChange={(e) => setLink({ ...link, icon: e.target.value })}
            >
              {icons.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <button type="button" className="ep-btn ep-btn--secondary ep-btn--sm" onClick={addLink}>
              Add link
            </button>
          </div>
        </fieldset>
      </div>
    </div>
  );
}
