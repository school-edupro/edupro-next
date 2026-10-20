import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';
import { ACR_STATUS, GROUP_LABEL, filterAcrRows, type AcrRow } from '@/lib/acr';

/**
 * A cycle's ACRs as a spreadsheet (CSV that Excel opens), with the board's filters. The API checks the right
 * to see every ACR.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const cycle = sp.get('cycle') ?? '';
  try {
    const b = await apiFetch<{ rows: AcrRow[] }>(
      `/people/acr/board${/^\d{1,18}$/.test(cycle) ? `?cycle=${cycle}` : ''}`,
    );
    const rows = filterAcrRows(b.rows, {
      status: sp.get('status') ?? undefined,
      group: sp.get('group') ?? undefined,
      level: sp.get('level') ?? undefined,
      dept: sp.get('dept') ?? undefined,
      type: sp.get('type') ?? undefined,
      q: sp.get('q') ?? undefined,
    });
    const cell = (v: unknown) => {
      const s = v === null || v === undefined ? '' : String(v);
      // a leading = + - @ would be read as a formula
      const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const head = [
      'Cycle',
      'Code',
      'Name',
      'Designation',
      'Department',
      'Employee type',
      'Staff',
      'Status',
      'Waiting on',
      'Self %',
      'Score %',
      'Grade',
      'Adverse',
    ];
    const lines = rows.map((r) =>
      [
        r.cycle,
        r.employee.code,
        r.employee.name,
        r.employee.designation,
        r.employee.department,
        r.employee.type,
        GROUP_LABEL[r.staffGroup],
        ACR_STATUS[r.status],
        r.level ? `${r.level.label ?? ''}: ${r.level.waitingOn.join(', ')}` : '',
        r.selfPct,
        r.scorePct,
        r.grade,
        r.adverse ? 'Yes' : '',
      ]
        .map(cell)
        .join(','),
    );
    const csv = `﻿${[head.map(cell).join(','), ...lines].join('\r\n')}\r\n`;
    return new NextResponse(csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="employee-acr.csv"`,
        'cache-control': 'private, no-store',
      },
    });
  } catch (e) {
    if (e instanceof ApiError) return new NextResponse(null, { status: e.status });
    throw e;
  }
}
