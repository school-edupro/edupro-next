import type { PoolClient } from '@edupro/db';

/**
 * docs/design/98: a section's indicators, remarks, exam attendance or height and weight reopened for entry while
 * the whole exam (or the class's lock of that area) stays locked. An opening lasts until the class teacher's Done,
 * the admin's Close now, a change of those locks, or its closing date-time (`exam_area_entry_opens`, 0414).
 */
export const ENTRY_AREAS = ['indicators', 'remarks', 'attendance', 'health'] as const;
export type EntryArea = (typeof ENTRY_AREAS)[number];

export const AREA_WORDS: Record<EntryArea, string> = {
  indicators: 'Indicators',
  remarks: 'Remarks',
  attendance: 'Exam attendance',
  health: 'Height and weight',
};

export interface AreaOpening {
  /** open until (ISO date-time) */
  until: string;
  reason: string;
  openedAt: string;
  openedBy: string | null;
}

export interface AreaEntry {
  /** nobody enters this area in this section now: the exam's or the class's lock, net of an opening */
  locked: boolean;
  /** the locks themselves (the admin's Reopen for entry is offered while one holds) */
  locks: { exam: boolean; class: boolean };
  /** reopened for entry under the lock: until when and why */
  open: AreaOpening | null;
}

/** each area's state for one section of an exam */
export async function areaEntries(
  c: PoolClient,
  examId: string,
  sectionId: string,
  classId: string,
): Promise<Record<EntryArea, AreaEntry>> {
  const l = await c.query<Record<EntryArea | 'exam', boolean>>(
    `SELECT e.marks_locked AS exam, COALESCE(ec.indicators_locked, false) AS indicators,
            COALESCE(ec.remarks_locked, false) AS remarks, COALESCE(ec.attendance_locked, false) AS attendance,
            COALESCE(ec.health_locked, false) AS health
       FROM exams e LEFT JOIN exam_classes ec ON ec.exam_id = e.id AND ec.class_id = $2
      WHERE e.id = $1`,
    [examId, classId],
  );
  const locks = l.rows[0] ?? {
    exam: false,
    indicators: false,
    remarks: false,
    attendance: false,
    health: false,
  };
  const o = await c.query<{
    area: EntryArea;
    closes_at: Date;
    reason: string;
    opened_at: Date;
    opened_by: string | null;
  }>(
    `SELECT o.area, o.closes_at, o.reason, o.opened_at, u.display_name AS opened_by
       FROM exam_area_entry_opens o LEFT JOIN users u ON u.id = o.opened_by
      WHERE o.exam_id = $1 AND o.class_section_id = $2 AND o.closed_at IS NULL AND o.closes_at > now()`,
    [examId, sectionId],
  );
  const opens = new Map(o.rows.map((x) => [x.area, x]));
  const out = {} as Record<EntryArea, AreaEntry>;
  for (const area of ENTRY_AREAS) {
    const held = { exam: locks.exam, class: locks[area] };
    const x = opens.get(area);
    // an opening counts only while a lock holds (unlocked, the area is open to everyone anyway)
    const open =
      x && (held.exam || held.class)
        ? {
            until: x.closes_at.toISOString(),
            reason: x.reason,
            openedAt: x.opened_at.toISOString(),
            openedBy: x.opened_by,
          }
        : null;
    out[area] = { locked: (held.exam || held.class) && !open, locks: held, open };
  }
  return out;
}

/**
 * Closes the openings a lock change ends (the whole exam locked or unlocked: every class and area; a class's lock
 * of an area changed: that class's sections for that area).
 */
export async function closeAreaOpenings(
  c: PoolClient,
  examId: string,
  only?: { classId: string; areas: EntryArea[] },
): Promise<number> {
  const r = await c.query(
    `UPDATE exam_area_entry_opens o SET closed_at = now(), closed_by = app.current_user_id(), closed_how = 'lock'
       FROM class_sections cs
      WHERE cs.id = o.class_section_id AND o.exam_id = $1 AND o.closed_at IS NULL
        AND ($2::bigint IS NULL OR cs.class_id = $2) AND ($3::text[] IS NULL OR o.area = ANY($3))`,
    [examId, only?.classId ?? null, only ? only.areas : null],
  );
  return r.rowCount ?? 0;
}
