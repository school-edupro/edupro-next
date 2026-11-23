import { NextResponse, type NextRequest } from 'next/server';
import { fileFrom } from '@/lib/file-proxy';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^\d{1,18}$/;
const STATUSES = ['waiting', 'pending', 'approved', 'rejected', 'withdrawn', 'cancelled'];

/**
 * The Employee Leave / Attendance page's files (docs/design/99), at the admin's paths: my leave, my month's
 * attendance, my reporties' leave and attendance as filtered on the tab — Excel or PDF.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const sp = req.nextUrl.searchParams;
  const q = new URLSearchParams({ format: sp.get('format') === 'pdf' ? 'pdf' : 'xlsx' });
  const dates = () => {
    for (const k of ['from', 'to']) if (DAY.test(sp.get(k) ?? '')) q.set(k, sp.get(k)!);
  };
  switch (file) {
    case 'my-leave-file':
      dates();
      return fileFrom(`/leave/self/leave-file?${q.toString()}`);
    case 'my-attendance-file': {
      const m = sp.get('month') ?? '';
      if (/^\d{4}-\d{2}$/.test(m)) q.set('month', m);
      return fileFrom(`/leave/self/attendance-file?${q.toString()}`);
    }
    case 'team-leave-file': {
      dates();
      for (const k of ['employeeId', 'leaveTypeId'])
        if (ID.test(sp.get(k) ?? '')) q.set(k, sp.get(k)!);
      const s = sp.get('status') ?? '';
      if (STATUSES.includes(s)) q.set('status', s);
      return fileFrom(`/leave/self/team?${q.toString()}`);
    }
    case 'team-attendance-file': {
      dates();
      const e = sp.get('employeeId') ?? '';
      if (ID.test(e)) q.set('employeeId', e);
      return fileFrom(`/staff-attendance/team?${q.toString()}`);
    }
    default:
      return new NextResponse(null, { status: 404 });
  }
}
