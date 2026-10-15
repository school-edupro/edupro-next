import { Alert, Button, Card, PageHeader } from '@edupro/ui';
import { HostelNav } from '@/components/hostel/HostelNav';
import { Notice } from '@/components/Notice';
import { getMe } from '@/lib/api';
import { uploadBeds } from '@/lib/hostel-actions';

/**
 * Go-live in one sheet: beds (made with their block and room when missing) and the pupils on them. Check
 * first (nothing kept, every problem listed by row), then apply.
 */
export default async function HostelUploadPage({
  searchParams,
}: {
  searchParams: Promise<{
    mode?: string;
    rows?: string;
    rooms?: string;
    beds?: string;
    allotted?: string;
    nosync?: string;
    bad?: string;
    problems?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  const ran = sp.mode === 'check' || sp.mode === 'apply';
  const bad = Number(sp.bad ?? 0);
  return (
    <>
      <PageHeader
        kicker="Hostel"
        title="Upload beds and allotments"
        description="Set up rooms and beds and put today's hostellers on them in one Excel. Hostels and room types are made on the Set-up screen first."
      />
      <HostelNav current="/hostel/upload" permissions={me.permissions} />
      <Notice params={{ error: sp.error, detail: sp.detail }} />
      {ran ? (
        <div style={{ marginBottom: 'var(--sp-4)' }}>
          <Alert tone={bad ? 'warning' : 'success'}>
            <strong>{sp.mode === 'apply' ? 'Applied.' : 'Checked — nothing was kept.'}</strong>{' '}
            {sp.rows} row(s): {sp.rooms} new room(s), {sp.beds} new bed(s), {sp.allotted} pupil(s)
            allotted
            {Number(sp.nosync)
              ? `, ${sp.nosync ?? ''} without a fee change (fee set-up missing)`
              : ''}
            {bad
              ? `; ${String(bad)} row(s) with a problem${sp.mode === 'apply' ? ' were left out' : ''}:`
              : '.'}
            {bad ? (
              <pre style={{ whiteSpace: 'pre-wrap', margin: 'var(--sp-2) 0 0' }}>{sp.problems}</pre>
            ) : null}
            {sp.mode === 'check' && !bad ? ' Upload the same file with “Apply” to keep it.' : ''}
          </Alert>
        </div>
      ) : null}
      <Card title="1. Download the format" style={{ marginBottom: 'var(--sp-4)' }}>
        <p>
          One row per bed: hostel code, block, floor, room no., room type, bed, and the admission
          no. and from date of the pupil on it (leave those empty for an empty bed). The hostel and
          room type columns are drop-downs of this school&apos;s set-up.
        </p>
        <a className="ep-btn ep-btn--secondary" href="/api/hostel/template">
          Download the Excel format
        </a>
      </Card>
      <Card title="2. Upload">
        <form action={uploadBeds} className="hs-form" style={{ maxWidth: '36rem' }}>
          <label className="ep-field" htmlFor="hu-file">
            <span className="ep-field__label">Filled Excel (.xlsx, up to 700 KB)</span>
            <input
              id="hu-file"
              name="file"
              type="file"
              required
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            />
          </label>
          <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <Button type="submit" name="mode" value="check" variant="secondary">
              Check (keep nothing)
            </Button>
            <Button type="submit" name="mode" value="apply">
              Apply
            </Button>
          </div>
          <span className="ep-field__help">
            Allotting a pupil makes them a hosteller and raises the hostel fee from the month of the
            from date, by the room type&apos;s fee group.
          </span>
        </form>
      </Card>
    </>
  );
}
