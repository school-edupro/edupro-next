'use client';
import { useId, useState, type KeyboardEvent, type ReactNode } from 'react';

export interface TabItem {
  id: string;
  label: ReactNode;
  content: ReactNode;
  disabled?: boolean;
}

export interface TabsProps {
  items: TabItem[];
  defaultTab?: string;
  activeTab?: string;
  onChange?: (id: string) => void;
  ariaLabel: string;
}

/** WAI-ARIA tabs with roving focus and arrow-key navigation. Underline in cyan marks the active tab. */
export function Tabs({ items, defaultTab, activeTab, onChange, ariaLabel }: TabsProps) {
  const baseId = useId();
  const [internal, setInternal] = useState(defaultTab ?? items[0]?.id ?? '');
  const current = activeTab ?? internal;
  const select = (id: string) => {
    if (activeTab === undefined) setInternal(id);
    onChange?.(id);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const enabled = items.filter((i) => !i.disabled);
    const pos = enabled.findIndex((i) => i.id === items[index]?.id);
    let next = pos;
    if (e.key === 'ArrowRight') next = (pos + 1) % enabled.length;
    else if (e.key === 'ArrowLeft') next = (pos - 1 + enabled.length) % enabled.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = enabled.length - 1;
    else return;
    e.preventDefault();
    const target = enabled[next];
    if (target) {
      select(target.id);
      document.getElementById(`${baseId}-tab-${target.id}`)?.focus();
    }
  };
  return (
    <div className="ep-tabs">
      <div role="tablist" aria-label={ariaLabel} className="ep-tabs__list">
        {items.map((item, index) => {
          const selected = item.id === current;
          return (
            <button
              key={item.id}
              id={`${baseId}-tab-${item.id}`}
              role="tab"
              type="button"
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${item.id}`}
              tabIndex={selected ? 0 : -1}
              disabled={item.disabled}
              className="ep-tabs__tab"
              onClick={() => select(item.id)}
              onKeyDown={(e) => onKeyDown(e, index)}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      {items.map((item) => (
        <div
          key={item.id}
          id={`${baseId}-panel-${item.id}`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-${item.id}`}
          hidden={item.id !== current}
          className="ep-tabs__panel"
          tabIndex={0}
        >
          {item.id === current ? item.content : null}
        </div>
      ))}
    </div>
  );
}
