import { redirect } from 'next/navigation';

/** Routes are kept in one place: Transport setup. Old links land on that tab. */
export default function Page() {
  redirect('/masters/transport?tab=transport_routes');
}
