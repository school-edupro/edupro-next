import mysql, { type Pool, type RowDataPacket } from 'mysql2/promise';
import type { Source } from '../pipeline';

export interface MysqlSourceOptions {
  uri: string; // mysql://user:pass@host:3306/legacy_db
  /** Column that carries the legacy year on per-year tables; defaults to FinancialYear. */
  yearColumn?: string;
  pageSize?: number;
}

/**
 * Streaming extractor over a restored legacy dump. Pages by primary key (srno) so memory stays flat on
 * tables with hundreds of thousands of rows. Not exercised in CI until a MySQL service exists (Sprint 4).
 */
export class MysqlSource implements Source<RowDataPacket> {
  private readonly pool: Pool;
  private readonly yearColumn: string;
  private readonly pageSize: number;

  constructor(opts: MysqlSourceOptions) {
    this.pool = mysql.createPool({
      uri: opts.uri,
      waitForConnections: true,
      connectionLimit: 4,
      dateStrings: true,
    });
    this.yearColumn = opts.yearColumn ?? 'FinancialYear';
    this.pageSize = opts.pageSize ?? 2000;
  }

  async *rows(table: string, year?: string): AsyncIterable<RowDataPacket> {
    const ident = (s: string) => `\`${s.replace(/`/g, '``')}\``;
    let lastId = 0;
    for (;;) {
      const params: unknown[] = [lastId];
      // eslint-disable-next-line no-restricted-syntax -- identifier quoted by ident(); values are bound as ? parameters
      let sql = `SELECT * FROM ${ident(table)} WHERE srno > ?`;
      if (year !== undefined) {
        sql += ` AND ${ident(this.yearColumn)} = ?`;
        params.push(year);
      }
      // eslint-disable-next-line no-restricted-syntax -- integer page size from configuration
      sql += ` ORDER BY srno LIMIT ${this.pageSize}`;
      const [rows] = await this.pool.query<RowDataPacket[]>(sql, params);
      if (rows.length === 0) return;
      for (const row of rows) {
        yield row;
        lastId = Number(row['srno'] ?? lastId);
      }
      if (rows.length < this.pageSize) return;
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
