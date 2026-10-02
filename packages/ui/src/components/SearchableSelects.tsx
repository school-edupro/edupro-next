'use client';
import { useEffect } from 'react';
import { installSearchableSelects } from './searchable-select';

/**
 * Mount once in an app's root layout: every single-choice select on every screen becomes searchable
 * (see searchable-select.ts). Renders nothing.
 */
export function SearchableSelects() {
  useEffect(() => installSearchableSelects(), []);
  return null;
}
