import { apiFetch } from '@/lib/api';
import type { AppointmentSetup } from '@/lib/appointments';

/** A page to print and put up: the school's booking QR code with one line of instruction. */
export default async function AppointmentPosterPage() {
  const { booking } = await apiFetch<AppointmentSetup>('/appointments/setup');
  return (
    <div className="ep-appt__poster">
      <p className="ep-kicker">{booking.school}</p>
      <h1>Book an appointment</h1>
      <p>Scan the code with your phone camera, confirm your mobile number and pick a time.</p>
      <img
        src={`data:image/svg+xml;utf8,${encodeURIComponent(booking.qr)}`}
        alt="QR code of the appointment booking page"
      />
      <p className="ep-field__help">{booking.url}</p>
      <p className="ep-field__help ep-appt__noprint">Use the browser’s Print to print this page.</p>
    </div>
  );
}
