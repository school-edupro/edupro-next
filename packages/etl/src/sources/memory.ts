import type { Source } from '../pipeline';

/** Fixture source for tests and dry runs: rows keyed by legacy table name. */
export class MemorySource<TRaw extends Record<string, unknown>> implements Source<TRaw> {
  constructor(private readonly tables: Record<string, TRaw[]>) {}

  async *rows(table: string, year?: string): AsyncIterable<TRaw> {
    for (const row of this.tables[table] ?? []) {
      if (year !== undefined && String(row['FinancialYear'] ?? '') !== year) continue;
      yield row;
    }
  }
}
