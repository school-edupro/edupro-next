// Fixture for the S2-12 lint rule: nothing below may be reported.
declare const c: { query(sql: string, params?: unknown[]): Promise<unknown> };
declare const cols: string;
declare const name: string;
declare const n: number;

export async function good(): Promise<void> {
  await c.query('SELECT id FROM classes WHERE id = $1', [n]);
  await c.query(
    `SELECT id, code
       FROM classes
      WHERE school_id = app.current_school_id()`,
  );
  // eslint-disable-next-line no-restricted-syntax -- cols is a constant column list
  await c.query(`SELECT ${cols} FROM classes WHERE id = $1`, [n]);
  const message = `Delete ${name}? ${n} sections will be removed`;
  void message;
}
