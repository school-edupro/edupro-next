// Fixture for the S2-12 lint rule: every statement below must be reported.
declare const c: { query(sql: string, params?: unknown[]): Promise<unknown> };
declare const table: string;
declare const id: string;

export async function bad(): Promise<void> {
  await c.query(`SELECT id FROM ${table}`);
  await c.query(`UPDATE users SET status = '${id}' WHERE id = 1`);
  await c.query(`DELETE FROM classes WHERE id = ${id}`);
  await c.query(`${'SELECT 1'} WHERE id = ${id}`);
}
