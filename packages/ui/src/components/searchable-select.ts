/**
 * Searchable drop-downs for every single-choice <select> on the page (2026-10-02: "every drop-down works
 * like a datalist"). The native select stays the source of truth: it keeps its label, `required`, form
 * submission and React `onChange`; only its picker is replaced by a list with a search box (shown from
 * SEARCH_FROM options). Only listed options can be chosen, so ids are submitted, never free text.
 *
 * Works through document-level listeners, so selects added later (dialogs, client screens) need nothing.
 * A select opts out with `data-native`, or every select inside an element with `data-native-selects`.
 */

const SEARCH_FROM = 8;
const MAX_SHOWN = 300;

interface Item {
  index: number;
  label: string;
  group: string | null;
  disabled: boolean;
  key: string;
}

let current: Picker | null = null;
let seq = 0;

const norm = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

export function eligible(el: EventTarget | null): el is HTMLSelectElement {
  return (
    el instanceof HTMLSelectElement &&
    !el.multiple &&
    el.size <= 1 &&
    !el.disabled &&
    !el.hasAttribute('data-native') &&
    !el.closest('[data-native-selects]')
  );
}

function itemsOf(select: HTMLSelectElement): Item[] {
  return Array.from(select.options).map((o, index) => {
    const label = (o.label || o.textContent || '').trim();
    const group = o.parentElement instanceof HTMLOptGroupElement ? o.parentElement.label : null;
    return { index, label, group, disabled: o.disabled, key: norm(`${label} ${group ?? ''}`) };
  });
}

function setValue(select: HTMLSelectElement, index: number): void {
  const option = select.options[index];
  if (!option) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  if (setter) setter.call(select, option.value);
  else select.value = option.value;
  select.selectedIndex = index;
  select.dispatchEvent(new Event('input', { bubbles: true }));
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

class Picker {
  readonly root: HTMLDivElement;
  private readonly list: HTMLUListElement;
  private readonly search: HTMLInputElement | null;
  private readonly empty: HTMLDivElement;
  private readonly items: Item[];
  private shown: Item[] = [];
  private active = -1;
  private readonly id = `ep-ss-${String((seq += 1))}`;

  constructor(
    readonly select: HTMLSelectElement,
    initial = '',
  ) {
    this.items = itemsOf(select);
    const label =
      select.getAttribute('aria-label') ??
      select.labels?.[0]?.textContent?.replace(/\*\s*$/, '').trim() ??
      'Choose';
    this.root = document.createElement('div');
    this.root.className = 'ep-ss';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', label);
    this.list = document.createElement('ul');
    this.list.className = 'ep-ss__list';
    this.list.id = `${this.id}-list`;
    this.list.setAttribute('role', 'listbox');
    this.list.setAttribute('aria-label', label);
    this.empty = document.createElement('div');
    this.empty.className = 'ep-ss__empty';
    this.empty.textContent = 'No match';
    this.empty.hidden = true;
    if (this.items.length >= SEARCH_FROM) {
      const s = document.createElement('input');
      s.type = 'search';
      s.className = 'ep-input ep-ss__search';
      s.placeholder = 'Type to search…';
      s.autocomplete = 'off';
      s.spellcheck = false;
      s.setAttribute('role', 'combobox');
      s.setAttribute('aria-expanded', 'true');
      s.setAttribute('aria-autocomplete', 'list');
      s.setAttribute('aria-controls', this.list.id);
      s.setAttribute('aria-label', `Search ${label}`);
      s.value = initial;
      s.addEventListener('input', () => this.render(true));
      s.addEventListener('keydown', (e) => this.key(e));
      this.search = s;
      this.root.append(s);
    } else {
      this.search = null;
      this.list.tabIndex = -1;
      this.list.addEventListener('keydown', (e) => this.key(e));
    }
    this.root.append(this.list, this.empty);
    // keep focus in the search box while clicking an option
    this.root.addEventListener('mousedown', (e) => {
      if (e.target !== this.search) e.preventDefault();
    });
    this.list.addEventListener('click', (e) => {
      const li = (e.target as HTMLElement).closest<HTMLLIElement>('li[data-i]');
      if (li && li.getAttribute('aria-disabled') !== 'true') this.pick(Number(li.dataset.i));
    });
    (select.closest('dialog[open]') ?? document.body).append(this.root);
    select.setAttribute('aria-expanded', 'true');
    this.render(Boolean(initial));
    this.place();
    (this.search ?? this.list).focus({ preventScroll: true });
  }

  private render(fromSearch: boolean): void {
    const terms = norm(this.search?.value ?? '')
      .split(' ')
      .filter(Boolean);
    const matches = terms.length
      ? this.items.filter((i) => terms.every((t) => i.key.includes(t)))
      : this.items;
    this.shown = matches.slice(0, MAX_SHOWN);
    const frag = document.createDocumentFragment();
    let group: string | null = null;
    for (const item of this.shown) {
      if (item.group !== null && item.group !== group) {
        const g = document.createElement('li');
        g.className = 'ep-ss__group';
        g.setAttribute('role', 'presentation');
        g.textContent = item.group;
        frag.append(g);
      }
      group = item.group;
      const li = document.createElement('li');
      li.id = `${this.id}-o${String(item.index)}`;
      li.className = 'ep-ss__option';
      li.setAttribute('role', 'option');
      li.dataset.i = String(item.index);
      li.textContent = item.label || ' ';
      const selected = item.index === this.select.selectedIndex;
      li.setAttribute('aria-selected', String(selected));
      if (item.disabled) li.setAttribute('aria-disabled', 'true');
      frag.append(li);
    }
    if (matches.length > MAX_SHOWN) {
      const more = document.createElement('li');
      more.className = 'ep-ss__more';
      more.setAttribute('role', 'presentation');
      more.textContent = `${String(matches.length - MAX_SHOWN)} more — type to narrow`;
      frag.append(more);
    }
    this.list.replaceChildren(frag);
    this.empty.hidden = this.shown.length > 0;
    const sel = this.shown.findIndex((i) => i.index === this.select.selectedIndex);
    const firstEnabled = this.shown.findIndex((i) => !i.disabled);
    this.move(fromSearch || sel < 0 ? firstEnabled : sel);
  }

  private move(pos: number): void {
    const prev = this.list.querySelector('.ep-ss__option[data-active]');
    prev?.removeAttribute('data-active');
    this.active = pos;
    const item = this.shown[pos];
    const owner = this.search ?? this.list;
    if (!item) {
      owner.removeAttribute('aria-activedescendant');
      return;
    }
    const li = this.list.querySelector<HTMLLIElement>(`#${this.id}-o${String(item.index)}`);
    if (li) {
      li.setAttribute('data-active', 'true');
      owner.setAttribute('aria-activedescendant', li.id);
      li.scrollIntoView({ block: 'nearest' });
    }
  }

  private step(from: number, by: number): number {
    let pos = from;
    for (let n = 0; n < this.shown.length; n += 1) {
      const next = Math.min(this.shown.length - 1, Math.max(0, pos + by));
      if (next === pos) break;
      pos = next;
      if (!this.shown[pos]?.disabled) return pos;
    }
    return this.shown[from]?.disabled === false ? from : this.active;
  }

  private key(e: KeyboardEvent): void {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        this.move(this.step(this.active, 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (e.altKey) this.close(true);
        else this.move(this.step(this.active, -1));
        break;
      case 'PageDown':
        e.preventDefault();
        this.move(this.step(Math.min(this.shown.length - 1, this.active + 9), 1));
        break;
      case 'PageUp':
        e.preventDefault();
        this.move(this.step(Math.max(0, this.active - 9), -1));
        break;
      case 'Home':
      case 'End':
        if (this.search) return; // caret movement in the search box
        e.preventDefault();
        this.move(e.key === 'Home' ? this.step(-1, 1) : this.step(this.shown.length, -1));
        break;
      case 'Enter': {
        e.preventDefault();
        const item = this.shown[this.active];
        if (item && !item.disabled) this.pick(item.index);
        break;
      }
      case 'Escape':
        e.preventDefault();
        e.stopPropagation(); // do not close a surrounding dialog
        this.close(true);
        break;
      case 'Tab':
        e.preventDefault();
        this.close(true);
        break;
      default:
        break;
    }
  }

  place(): void {
    const r = this.select.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const width = Math.min(Math.max(r.width, 220), vw - 16);
    const left = Math.min(Math.max(8, r.left), vw - width - 8);
    const below = vh - r.bottom - 8;
    const above = r.top - 8;
    const up = below < 240 && above > below;
    const room = Math.max(160, Math.min(360, up ? above : below));
    this.root.style.left = `${String(left)}px`;
    this.root.style.width = `${String(width)}px`;
    this.root.style.maxHeight = `${String(room)}px`;
    if (up) {
      this.root.style.top = '';
      this.root.style.bottom = `${String(vh - r.top + 4)}px`;
    } else {
      this.root.style.bottom = '';
      this.root.style.top = `${String(r.bottom + 4)}px`;
    }
  }

  private pick(index: number): void {
    if (index !== this.select.selectedIndex) setValue(this.select, index);
    this.close(true);
  }

  close(refocus: boolean): void {
    this.root.remove();
    this.select.removeAttribute('aria-expanded');
    if (current === this) current = null;
    if (refocus) this.select.focus({ preventScroll: true });
  }
}

function open(select: HTMLSelectElement, initial = ''): void {
  current?.close(false);
  select.focus({ preventScroll: true });
  current = new Picker(select, initial);
}

/** Installs the document listeners; returns the uninstall function (for React effects). */
export function installSearchableSelects(doc: Document = document): () => void {
  let touch: { x: number; y: number } | null = null;

  const onMouseDown = (e: MouseEvent) => {
    if (current && !current.root.contains(e.target as Node)) {
      const same = e.target === current.select;
      current.close(false);
      if (same) {
        e.preventDefault();
        return;
      }
    }
    if (e.button !== 0 || !eligible(e.target)) return;
    e.preventDefault();
    open(e.target);
  };
  const onTouchStart = (e: TouchEvent) => {
    const t = e.touches[0];
    touch = t && eligible(e.target) ? { x: t.clientX, y: t.clientY } : null;
  };
  const onTouchEnd = (e: TouchEvent) => {
    const t = e.changedTouches[0];
    if (!touch || !t || !eligible(e.target)) return;
    const moved = Math.abs(t.clientX - touch.x) + Math.abs(t.clientY - touch.y) > 10;
    touch = null;
    if (moved) return; // a scroll, not a tap
    e.preventDefault(); // no native picker
    if (current?.select === e.target) current.close(true);
    else open(e.target);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (!eligible(e.target) || e.ctrlKey || e.metaKey) return;
    const select = e.target;
    const opens =
      e.key === 'Enter' ||
      e.key === ' ' ||
      e.key === 'F4' ||
      (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp'));
    const typed =
      e.key.length === 1 && e.key !== ' ' && !e.altKey && select.options.length >= SEARCH_FROM;
    if (!opens && !typed) return;
    e.preventDefault();
    open(select, typed ? e.key : '');
  };
  const onScroll = (e: Event) => {
    if (current && !current.root.contains(e.target as Node)) current.place();
  };
  const onResize = () => current?.close(false);

  doc.addEventListener('mousedown', onMouseDown, true);
  doc.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
  doc.addEventListener('touchend', onTouchEnd, { capture: true, passive: false });
  doc.addEventListener('keydown', onKeyDown, true);
  doc.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', onResize);
  return () => {
    current?.close(false);
    doc.removeEventListener('mousedown', onMouseDown, true);
    doc.removeEventListener('touchstart', onTouchStart, true);
    doc.removeEventListener('touchend', onTouchEnd, true);
    doc.removeEventListener('keydown', onKeyDown, true);
    doc.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', onResize);
  };
}
