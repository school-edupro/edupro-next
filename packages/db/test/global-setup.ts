/**
 * The tests make schools of their own. Once the run is over, the ones it made (newer than the last id
 * noted here, named by their test code) are retired: left active, thousands of them had the marts
 * refresh and the other per-school jobs walk them all day.
 */
import { Client } from 'pg';

const url =
  process.env.DATABASE_MIGRATOR_URL ??
  'postgresql://edupro_migrator:edupro_migrator_dev@localhost:5432/edupro';

async function withClient<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

export default async function setup(): Promise<() => Promise<void>> {
  const before = await withClient(async (c) => {
    const r = await c.query<{ m: string }>('SELECT COALESCE(max(id), 0)::text AS m FROM schools');
    return r.rows[0]!.m;
  });
  return async () => {
    await withClient((c) =>
      c.query(
        `UPDATE schools SET status = 'inactive', updated_at = now()
          WHERE id > $1::bigint AND status = 'active'
            AND (name = code OR (name LIKE '% School _' AND code = regexp_replace(name, ' School (.)$', '\\1')))`,
        [before],
      ),
    );
  };
}
