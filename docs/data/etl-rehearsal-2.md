# ETL rehearsal 2 (Sprint 11): dry run on a synthetic extract

The plan's rehearsal 2 runs all domains on a recent production dump with zero unexplained delta on identity.
The dumps (S0-08) have not been shared, so Sprint 11 ran the transforms end to end on a synthetic extract
shaped like the pilot's tables (`packages/etl/fixtures/rehearsal-2`, 1,745 rows across 8 tables) through
`packages/etl/test/rehearsal.test.ts`. Loaders and the bookkeeping schema are unchanged since rehearsal 1.

| Table                  | Extracted | Transformed | Rejected | Reasons                        |
| ---------------------- | --------- | ----------- | -------- | ------------------------------ |
| student_master         | 200       | 200         | 0        |                                |
| attendance             | 1,200     | 1,140       | 60       | date.unparseable (one bad day) |
| attendancelogs_rfid    | 60        | 54          | 6        | rfid.direction_unknown         |
| employee_notice        | 40        | 36          | 4        | notice.empty                   |
| homework_master        | 100       | 93          | 7        | homework.empty                 |
| parent_query           | 80        | 76          | 4        | query.empty                    |
| parent_query_responses | 60        | 60          | 0        | (no orphan responses)          |
| Fees_Head              | 5         | 5           | 0        |                                |

Every reject carries a coded reason; legacy keys are unique per table; every response points at an existing
query. What remains for the real rehearsal: extraction from MySQL (the CLI's `mysql2` source), loading into a
scratch tenant, and the reconciliation measures against legacy totals per year. Those steps run unchanged once
the dumps arrive.
