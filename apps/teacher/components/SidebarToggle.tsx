'use client';

import { useEffect, useState, type ReactNode } from 'react';

const KEY = 'edupro.sidebar.collapsed';

/**
 * Collapses the sidebar to its icon rail (the header hamburger and the "Collapse" control at the
 * bottom of the sidebar share it). The choice is a per-browser convenience kept in localStorage;
 * without JavaScript the sidebar simply stays open.
 */
export function SidebarToggle({
  children,
  className,
  label,
}: {
  children: ReactNode;
  className?: string;
  label: string;
}) {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    let stored = false;
    try {
      stored = localStorage.getItem(KEY) === '1';
    } catch {
      stored = false;
    }
    setCollapsed(stored);
    document.querySelector('.ep-shell')?.setAttribute('data-collapsed', stored ? 'true' : 'false');
  }, []);
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    document.querySelector('.ep-shell')?.setAttribute('data-collapsed', next ? 'true' : 'false');
    try {
      localStorage.setItem(KEY, next ? '1' : '0');
    } catch {
      /* private mode: the choice lasts for the page only */
    }
  };
  return (
    <button
      type="button"
      className={className}
      onClick={toggle}
      aria-pressed={collapsed}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}
