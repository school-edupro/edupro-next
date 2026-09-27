import type { PersonRow } from './identity';

/** One line per person for the One Auth bulk provisioning template (mobile is the primary identifier). */
export interface ProvisioningRow {
  legacyTable: string;
  legacyKey: string;
  displayName: string;
  mobile: string;
  email: string;
  personType: string;
  suggestedRole: string;
  status: string;
}

export function provisioningRows(rows: PersonRow[]): ProvisioningRow[] {
  const seen = new Set<string>();
  const out: ProvisioningRow[] = [];
  for (const r of rows) {
    if (seen.has(r.oneauthSub)) continue;
    seen.add(r.oneauthSub);
    out.push({
      legacyTable: r.legacyTable,
      legacyKey: r.legacyKey,
      displayName: r.displayName,
      mobile: r.mobile ?? '',
      email: r.email ?? '',
      personType: r.personType,
      suggestedRole: r.suggestedRole ?? '',
      status: r.status,
    });
  }
  return out;
}

export function toProvisioningCsv(rows: ProvisioningRow[]): string {
  const esc = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const header = [
    'legacy_table',
    'legacy_key',
    'display_name',
    'mobile',
    'email',
    'person_type',
    'suggested_role',
    'status',
  ];
  const lines = [header.join(',')];
  for (const r of rows)
    lines.push(
      [
        r.legacyTable,
        r.legacyKey,
        r.displayName,
        r.mobile,
        r.email,
        r.personType,
        r.suggestedRole,
        r.status,
      ]
        .map(esc)
        .join(','),
    );
  return '﻿' + lines.join('\r\n') + '\r\n';
}
