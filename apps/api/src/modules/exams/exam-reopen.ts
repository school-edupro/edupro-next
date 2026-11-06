import type { PoolClient } from '@edupro/db';

/**
 * 6 Nov 2026 (asked): opening marks again — the whole exam unlocked, or one class opened — lets every
 * teacher of it enter again. What stands in the way goes, with the admin's reason: the class's results
 * published on a released report card are taken back (no message is sent; publishing again tells the
 * families as usual), and its submitted and verified sheets are reopened (each logged with the reason).
 */
export interface ReopenImpact {
  classId: string;
  classCode: string;
  /** the submitted and verified sheets that reopen */
  reopen: number;
  /** the released cards the class is taken back from */
  cards: Array<{ releaseId: string; name: string }>;
}

/** what opening the exam (every class) or one class would reopen and take back */
export async function reopenImpact(
  c: PoolClient,
  examId: string,
  classId: string | null,
): Promise<ReopenImpact[]> {
  const sheets = await c.query<{ class_id: string; class_code: string; n: number }>(
    `SELECT es.class_id::text, k.code AS class_code, count(*)::int AS n
       FROM exam_entry_status st JOIN exam_subjects es ON es.id = st.exam_subject_id
       JOIN classes k ON k.id = es.class_id
      WHERE es.exam_id = $1 AND ($2::bigint IS NULL OR es.class_id = $2::bigint)
        AND st.status IN ('submitted', 'verified')
      GROUP BY 1, 2`,
    [examId, classId],
  );
  const cards = await c.query<{
    class_id: string;
    class_code: string;
    release_id: string;
    name: string;
  }>(
    `SELECT x.class_id::text, k.code AS class_code, r.id::text AS release_id, r.name
       FROM report_card_releases r
       JOIN report_card_release_classes x ON x.release_id = r.id AND x.status = 'released'
       JOIN classes k ON k.id = x.class_id
      WHERE $1::bigint = ANY(r.exam_ids) AND ($2::bigint IS NULL OR x.class_id = $2::bigint)
      ORDER BY k.display_order, r.id`,
    [examId, classId],
  );
  const out = new Map<string, ReopenImpact>();
  const at = (id: string, code: string) => {
    const x = out.get(id) ?? { classId: id, classCode: code, reopen: 0, cards: [] };
    out.set(id, x);
    return x;
  };
  for (const s of sheets.rows) at(s.class_id, s.class_code).reopen = s.n;
  for (const k of cards.rows)
    at(k.class_id, k.class_code).cards.push({ releaseId: k.release_id, name: k.name });
  return [...out.values()].sort((a, b) => a.classCode.localeCompare(b.classCode));
}

/** the words of an impact, for a refusal or a dialog: "VI: 19 sheets, the card "Periodic Test 1"" */
export const impactWords = (list: ReopenImpact[]): string =>
  list
    .map(
      (x) =>
        `${x.classCode}: ${[
          x.reopen ? `${String(x.reopen)} sheet${x.reopen === 1 ? '' : 's'}` : '',
          ...x.cards.map((k) => `the card "${k.name}"`),
        ]
          .filter(Boolean)
          .join(', ')}`,
    )
    .join('; ');

/** the released cards of the exam a class is published on, taken back with the reason (no message) */
export async function takeBackCards(
  c: PoolClient,
  examId: string,
  classId: string,
  reason: string,
): Promise<string[]> {
  const impact = await reopenImpact(c, examId, classId);
  const out: string[] = [];
  for (const x of impact)
    for (const k of x.cards) {
      await c.query(
        `UPDATE report_card_release_classes SET status = 'withdrawn', withdrawn_at = now(),
                withdrawn_by = app.current_user_id(), withdrawn_reason = $3
          WHERE release_id = $1 AND class_id = $2 AND status = 'released'`,
        [k.releaseId, x.classId, reason],
      );
      await c.query(
        `UPDATE report_card_releases SET status = 'withdrawn', withdrawn_at = now(), withdrawn_by = app.current_user_id(),
                withdrawn_reason = $2, updated_at = now()
          WHERE id = $1 AND status = 'released'
            AND NOT EXISTS (SELECT 1 FROM report_card_release_classes x WHERE x.release_id = $1 AND x.status = 'released')`,
        [k.releaseId, reason],
      );
      out.push(`${x.classCode} ("${k.name}")`);
    }
  return out;
}

/** takes the cards back and reopens the sheets (the exam or one class), then works the results out */
export async function reopenExamMarks(
  c: PoolClient,
  examId: string,
  classId: string | null,
  reason: string,
  how: string,
): Promise<{ reopened: number; revoked: string[] }> {
  const impact = await reopenImpact(c, examId, classId);
  const revoked: string[] = [];
  for (const x of impact)
    if (x.cards.length) revoked.push(...(await takeBackCards(c, examId, x.classId, reason)));
  const rows = await c.query<{ es: string; section: string; status: string }>(
    `SELECT st.exam_subject_id::text AS es, st.class_section_id::text AS section, st.status::text AS status
       FROM exam_entry_status st JOIN exam_subjects es ON es.id = st.exam_subject_id
      WHERE es.exam_id = $1 AND ($2::bigint IS NULL OR es.class_id = $2::bigint)
        AND st.status IN ('submitted', 'verified')
      FOR UPDATE OF st`,
    [examId, classId],
  );
  for (const r of rows.rows) {
    await c.query(
      `UPDATE exam_entry_status SET status = 'open', submitted_by = NULL, submitted_at = NULL,
              verified_by = NULL, verified_at = NULL, remark = $3, updated_at = now()
        WHERE exam_subject_id = $1 AND class_section_id = $2`,
      [r.es, r.section, `${how}: ${reason}`],
    );
    await c.query(
      `INSERT INTO exam_entry_status_log (school_id, exam_subject_id, class_section_id, from_status, to_status, note, actor_user_id)
       VALUES (app.current_school_id(), $1, $2, $3, 'open', $4, app.current_user_id())`,
      [r.es, r.section, r.status, `${how}: ${reason}`],
    );
  }
  if (rows.rows.length) await c.query(`SELECT app.compute_exam_results($1)`, [examId]);
  return { reopened: rows.rows.length, revoked };
}
