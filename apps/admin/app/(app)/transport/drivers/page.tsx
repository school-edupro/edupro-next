import { redirect } from 'next/navigation';

/** Crew (drivers, conductors, attendants) are kept in one place: Transport setup. Old links land on that tab. */
export default function Page() {
  redirect('/masters/transport?tab=transport_drivers');
}
