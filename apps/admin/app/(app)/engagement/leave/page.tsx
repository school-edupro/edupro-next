import QueriesPage from '../queries/page';

type Search = {
  ok?: string;
  error?: string;
  detail?: string;
  status?: string;
  categoryCode?: string;
};

/** Leave requests from families: their own module (approve / reject by the class teacher), no SLA. */
export default async function LeavePage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  return QueriesPage({ searchParams: Promise.resolve({ ...sp, kind: 'leave' }) });
}
