/**
 * Staging anonymisation (S5-06): replaces personal data in a restored copy with synthetic values so
 * staging never holds real contact details. Runs as the migrator inside one transaction. Refuses unless
 * ALLOW_ANONYMISE=1 and the database name looks like a non-production copy.
 *
 *   ALLOW_ANONYMISE=1 DATABASE_MIGRATOR_URL=postgresql://.../edupro_staging pnpm --filter @edupro/db anonymise
 */
import { Client } from 'pg';

const SAFE_DB = /(staging|scratch|drill|test|anon)/i;

export const ANONYMISE_STATEMENTS: string[] = [
  // people
  `UPDATE students SET first_name = 'Student', last_name = 'S' || id, dob = date_trunc('year', dob)::date, address = '{}'::jsonb, details = '{}'::jsonb`,
  `UPDATE guardians SET first_name = 'Guardian', last_name = 'G' || id, mobile = CASE WHEN mobile IS NULL THEN NULL ELSE '9' || lpad((id % 1000000000)::text, 9, '0') END, email = CASE WHEN email IS NULL THEN NULL ELSE 'guardian' || id || '@example.test' END, occupation = NULL, address = '{}'::jsonb, details = '{}'::jsonb`,
  `UPDATE employees SET first_name = 'Employee', last_name = 'E' || id, dob = date_trunc('year', dob)::date, mobile = CASE WHEN mobile IS NULL THEN NULL ELSE '8' || lpad((id % 1000000000)::text, 9, '0') END, email = CASE WHEN email IS NULL THEN NULL ELSE 'employee' || id || '@example.test' END, address = '{}'::jsonb, details = '{}'::jsonb`,
  `UPDATE person_documents SET number = NULL, title = NULL`,
  // identities: keep the dev and legacy subjects, replace contact details
  `UPDATE users SET display_name = 'User ' || id, mobile = CASE WHEN mobile IS NULL THEN NULL ELSE '7' || lpad((id % 1000000000)::text, 9, '0') END, email = CASE WHEN email IS NULL THEN NULL ELSE 'user' || id || '@example.test' END, oneauth_sub = CASE WHEN oneauth_sub LIKE 'pending:%' THEN 'pending:7' || lpad((id % 1000000000)::text, 9, '0') ELSE oneauth_sub END WHERE oneauth_sub NOT LIKE 'dev-%'`,
  // communication and files
  `UPDATE comms_messages SET recipient_address = CASE WHEN channel = 'email' THEN 'recipient' || id || '@example.test' ELSE '7' || lpad((id % 1000000000)::text, 9, '0') END, body = '[anonymised]', subject = CASE WHEN subject IS NULL THEN NULL ELSE '[anonymised]' END, variables = '{}'::jsonb`,
  `UPDATE comms_templates SET sender_id = NULL`,
  `UPDATE files SET original_name = 'file-' || id`,
  // audit images keep structure, lose personal values
  `UPDATE audit_logs SET before = CASE WHEN before IS NULL THEN NULL ELSE '{"anonymised": true}'::jsonb END, after = CASE WHEN after IS NULL THEN NULL ELSE '{"anonymised": true}'::jsonb END, diff = NULL, ip = NULL, user_agent = NULL`,
  `UPDATE login_events SET ip = NULL, user_agent = NULL, detail = '{}'::jsonb`,
  `UPDATE impersonation_sessions SET reason = '[anonymised]'`,
  `UPDATE break_glass_events SET reason = '[anonymised]'`,
  `UPDATE delegations SET reason = '[anonymised]'`,
  `UPDATE user_roles SET reason = '[anonymised]'`,
  // school contact details
  `UPDATE schools SET contact = '{}'::jsonb, address = jsonb_build_object('city', address->>'city', 'state', address->>'state')`,
  `UPDATE campuses SET address = '{}'::jsonb, geo = NULL`,
];

export function assertAnonymiseAllowed(url: string, env: NodeJS.ProcessEnv = process.env): void {
  if (env.ALLOW_ANONYMISE !== '1') throw new Error('ALLOW_ANONYMISE=1 is required');
  const dbName = new URL(url).pathname.replace(/^\//, '');
  if (!SAFE_DB.test(dbName))
    throw new Error(
      `refusing to anonymise database "${dbName}": name must contain staging, scratch, drill, test or anon`,
    );
}

export async function anonymise(client: Client): Promise<number> {
  let rows = 0;
  // audit_logs is append-only through a trigger (ADR-005); the owner lifts it for this transaction only.
  await client.query('ALTER TABLE audit_logs DISABLE TRIGGER USER');
  try {
    for (const sql of ANONYMISE_STATEMENTS) {
      const r = await client.query(sql);
      rows += r.rowCount ?? 0;
    }
  } finally {
    await client.query('ALTER TABLE audit_logs ENABLE TRIGGER USER');
  }
  return rows;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_MIGRATOR_URL;
  if (!url) throw new Error('DATABASE_MIGRATOR_URL is required');
  assertAnonymiseAllowed(url);
  const client = new Client({ connectionString: url, application_name: 'edupro-anonymise' });
  await client.connect();
  try {
    await client.query('BEGIN');
    const rows = await anonymise(client);
    await client.query('COMMIT');
    process.stdout.write(`anonymised ${rows} rows\n`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
