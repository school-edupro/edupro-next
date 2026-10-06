import { redirect } from 'next/navigation';

/** Classes, sections and subjects are kept in one place: Academics → Setup. */
export default function Moved() {
  redirect('/masters/academics?tab=classes');
}
