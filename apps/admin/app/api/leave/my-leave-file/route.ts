import type { NextRequest } from 'next/server';
import { fileFrom } from '@/lib/file-proxy';

/** All my leave as Excel or PDF. */
export async function GET(req: NextRequest) {
  const format = req.nextUrl.searchParams.get('format') === 'pdf' ? 'pdf' : 'xlsx';
  return fileFrom(`/leave/self/leave-file?format=${format}`);
}
