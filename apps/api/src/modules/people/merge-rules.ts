/**
 * What a student merge does with each table that points at a student (docs/design/37, part 3). Every
 * foreign key to students and every "person" column that can name a student is listed here; a test
 * (student-merges.e2e-spec) fails when a table is added without a rule.
 *
 * - move: the duplicate's rows go to the record kept.
 * - keep: like move, but where both hold a row of the same thing (`key`, or the `clash` condition), the
 *   kept record's stays and the duplicate's is removed.
 * - leave: stays on the duplicate (its own history).
 * - special: handled in code (fee lines and receipts, logins).
 *
 * `{a}` in a key, scope or where stands for the table's alias (the duplicate's row `d`, the kept `k`).
 */
export type MergeArea =
  | 'class'
  | 'fees'
  | 'attendance'
  | 'marks'
  | 'library'
  | 'documents'
  | 'guardians'
  | 'transport'
  | 'hostel'
  | 'health'
  | 'requests'
  | 'admissions'
  | 'other';

export const MERGE_AREA_LABEL: Record<MergeArea, string> = {
  class: 'Class and roll number',
  fees: 'Fees and receipts',
  attendance: 'Attendance',
  marks: 'Marks and results',
  library: 'Library',
  documents: 'Documents and certificates',
  guardians: 'Parents and guardians',
  transport: 'Transport',
  hostel: 'Hostel',
  health: 'Health',
  requests: 'Requests, messages and consents',
  admissions: 'Admission records',
  other: 'Other records',
};

export interface MergeRule {
  table: string;
  col: string;
  area: MergeArea;
  how: 'move' | 'keep' | 'leave' | 'special';
  /** keep: the columns (or `{a}` expressions) that make two rows the same thing. */
  key?: string[];
  /** keep: a clash condition of its own, on the duplicate's row `d` ($1 = the kept record). */
  clash?: string;
  /** keep: only rows in this state can clash (e.g. not revoked). */
  scope?: string;
  /** only these rows name a student (a person column shared by several kinds). */
  where?: string;
  /** What the kept record keeps on a clash, in words for the preview. */
  rule?: string;
}

const yearOfProfile = `EXISTS (SELECT 1 FROM student_fee_profiles k WHERE k.student_id = $1 AND k.academic_year_id = d.academic_year_id)`;

export const MERGE_RULES: MergeRule[] = [
  // ---- fees (lines and receipts are special; the rest follow) -----------------------------------
  { table: 'fee_demands', col: 'student_id', area: 'fees', how: 'special' },
  { table: 'fee_payments', col: 'student_id', area: 'fees', how: 'special' },
  {
    table: 'student_fee_profiles',
    col: 'student_id',
    area: 'fees',
    how: 'keep',
    key: ['academic_year_id'],
    rule: 'the kept record’s fee category, plan and discount for the year',
  },
  {
    table: 'student_fee_discounts',
    col: 'student_id',
    area: 'fees',
    how: 'keep',
    clash: yearOfProfile,
    rule: 'the kept record’s discounts in a year it has a fee profile',
  },
  {
    table: 'student_fee_optional_heads',
    col: 'student_id',
    area: 'fees',
    how: 'keep',
    clash: yearOfProfile,
    rule: 'the kept record’s optional heads in a year it has a fee profile',
  },
  { table: 'fee_demand_runs', col: 'student_id', area: 'fees', how: 'move' },
  { table: 'fee_adjustments', col: 'student_id', area: 'fees', how: 'move' },
  { table: 'fee_carry_forwards', col: 'student_id', area: 'fees', how: 'move' },
  { table: 'fee_change_requests', col: 'student_id', area: 'fees', how: 'move' },
  { table: 'fee_change_requests', col: 'to_student_id', area: 'fees', how: 'move' },
  {
    table: 'fee_late_fee_overrides',
    col: 'student_id',
    area: 'fees',
    how: 'keep',
    key: ['academic_year_id', 'period_id', 'ledger'],
    scope: '{a}.revoked_at IS NULL',
    rule: 'the kept record’s late-fee waiver of the month',
  },
  { table: 'fee_late_fee_postings', col: 'student_id', area: 'fees', how: 'move' },
  { table: 'fee_profile_changes', col: 'student_id', area: 'fees', how: 'move' },
  { table: 'fee_refunds', col: 'student_id', area: 'fees', how: 'move' },
  {
    table: 'fee_reminders',
    col: 'student_id',
    area: 'fees',
    how: 'keep',
    key: ['sent_on', 'channel', 'COALESCE({a}.misc_fee_id, 0)'],
    rule: 'one reminder a day',
  },
  { table: 'misc_fee_students', col: 'student_id', area: 'fees', how: 'move' },
  { table: 'misc_receipts', col: 'student_id', area: 'fees', how: 'move' },
  { table: 'shadow_legacy_balances', col: 'student_id', area: 'fees', how: 'move' },
  { table: 'shadow_legacy_receipts', col: 'student_id', area: 'fees', how: 'move' },
  {
    table: 'payment_intents',
    col: 'entity_id',
    area: 'fees',
    how: 'move',
    where: `{a}.entity_type = 'student'`,
  },

  // ---- class: promotion decisions before the enrolments they point at -----------------------------
  {
    table: 'promotion_decisions',
    col: 'student_id',
    area: 'class',
    how: 'keep',
    key: ['from_year_id'],
    rule: 'the kept record’s promotion decision',
  },
  {
    table: 'enrolments',
    col: 'student_id',
    area: 'class',
    how: 'keep',
    key: ['academic_year_id'],
    rule: 'the kept record’s class and roll number in a year both are enrolled',
  },
  { table: 'class_corrections', col: 'student_id', area: 'class', how: 'move' },
  { table: 'student_corrections', col: 'student_id', area: 'class', how: 'move' },

  // ---- attendance --------------------------------------------------------------------------------
  {
    table: 'attendance_marks',
    col: 'student_id',
    area: 'attendance',
    how: 'keep',
    // the same day (and period), whichever section's register it was marked in
    clash: `EXISTS (SELECT 1 FROM attendance_marks k JOIN attendance_sessions ks ON ks.id = k.session_id
                     JOIN attendance_sessions ds ON ds.id = d.session_id
                    WHERE k.student_id = $1 AND ks.on_date = ds.on_date AND ks.kind = ds.kind
                      AND COALESCE(ks.subject_id, 0) = COALESCE(ds.subject_id, 0) AND COALESCE(ks.period_id, 0) = COALESCE(ds.period_id, 0))`,
    rule: 'the kept record’s mark of the day',
  },
  {
    table: 'student_attendance_rules',
    col: 'student_id',
    area: 'attendance',
    how: 'keep',
    key: ['academic_year_id'],
    rule: 'the kept record’s attendance rule of the year',
  },
  { table: 'student_leaves', col: 'student_id', area: 'attendance', how: 'move' },
  { table: 'rfid_events', col: 'student_id', area: 'attendance', how: 'move' },

  // ---- marks -------------------------------------------------------------------------------------
  {
    table: 'mark_entries',
    col: 'student_id',
    area: 'marks',
    how: 'keep',
    key: ['exam_subject_id'],
    rule: 'the kept record’s marks of a subject',
  },
  {
    table: 'mark_part_entries',
    col: 'student_id',
    area: 'marks',
    how: 'keep',
    key: ['part_id'],
    rule: 'the kept record’s marks of a part',
  },
  {
    table: 'indicator_entries',
    col: 'student_id',
    area: 'marks',
    how: 'keep',
    key: ['exam_id', 'indicator_id'],
    rule: 'the kept record’s grades',
  },
  {
    table: 'exam_results',
    col: 'student_id',
    area: 'marks',
    how: 'keep',
    key: ['exam_id'],
    rule: 'the kept record’s result of an exam',
  },
  {
    table: 'exam_remarks',
    col: 'student_id',
    area: 'marks',
    how: 'keep',
    key: ['exam_id'],
    rule: 'the kept record’s remarks',
  },
  {
    table: 'exam_attendance',
    col: 'student_id',
    area: 'marks',
    how: 'keep',
    key: ['exam_id'],
    rule: 'the kept record’s exam attendance',
  },
  {
    table: 'report_cards',
    col: 'student_id',
    area: 'marks',
    how: 'keep',
    key: ['release_id'],
    rule: 'the kept record’s report card',
  },
  { table: 'board_results', col: 'student_id', area: 'marks', how: 'move' },

  // ---- library -----------------------------------------------------------------------------------
  {
    table: 'library_loans',
    col: 'borrower_id',
    area: 'library',
    how: 'move',
    where: `{a}.borrower_kind = 'student'`,
  },
  {
    table: 'library_charges',
    col: 'borrower_id',
    area: 'library',
    how: 'move',
    where: `{a}.borrower_kind = 'student'`,
  },
  {
    table: 'library_reservations',
    col: 'borrower_id',
    area: 'library',
    how: 'keep',
    key: ['title_id'],
    where: `{a}.borrower_kind = 'student'`,
    scope: `{a}.status IN ('waiting', 'ready')`,
    rule: 'one waiting reservation of a title',
  },
  {
    table: 'library_sales',
    col: 'buyer_id',
    area: 'library',
    how: 'move',
    where: `{a}.buyer_kind = 'student'`,
  },
  {
    table: 'library_sale_orders',
    col: 'buyer_id',
    area: 'library',
    how: 'move',
    where: `{a}.buyer_kind = 'student'`,
  },

  // ---- documents ---------------------------------------------------------------------------------
  {
    table: 'files',
    col: 'owner_entity_id',
    area: 'documents',
    how: 'move',
    where: `{a}.owner_entity_type IN ('student', 'students')`,
  },
  {
    table: 'person_documents',
    col: 'person_id',
    area: 'documents',
    how: 'move',
    where: `{a}.person_type = 'student'`,
  },
  { table: 'certificates_issued', col: 'student_id', area: 'documents', how: 'move' },
  { table: 'transfer_certificates', col: 'student_id', area: 'documents', how: 'move' },

  // ---- parents -----------------------------------------------------------------------------------
  {
    table: 'student_guardians',
    col: 'student_id',
    area: 'guardians',
    how: 'keep',
    key: ['guardian_id'],
    rule: 'one link to the same parent',
  },

  // ---- transport ---------------------------------------------------------------------------------
  {
    table: 'student_route_assignments',
    col: 'student_id',
    area: 'transport',
    how: 'keep',
    key: ['academic_year_id'],
    rule: 'the kept record’s route of the year',
  },
  {
    table: 'student_transport',
    col: 'student_id',
    area: 'transport',
    how: 'keep',
    clash: `EXISTS (SELECT 1 FROM student_transport k WHERE k.student_id = $1 AND k.academic_year_id = d.academic_year_id AND k.status <> 'cancelled')`,
    rule: 'the kept record’s transport of the year',
  },
  { table: 'transport_requests', col: 'student_id', area: 'transport', how: 'move' },
  { table: 'bus_attendance', col: 'student_id', area: 'transport', how: 'move' },
  {
    table: 'bus_roll_marks',
    col: 'student_id',
    area: 'transport',
    how: 'keep',
    key: ['session_id'],
    rule: 'the kept record’s bus mark of the trip',
  },

  // ---- hostel ------------------------------------------------------------------------------------
  { table: 'hostel_allotments', col: 'student_id', area: 'hostel', how: 'move' },
  {
    table: 'hostel_diets',
    col: 'student_id',
    area: 'hostel',
    how: 'keep',
    key: [],
    rule: 'the kept record’s diet',
  },
  { table: 'hostel_exit_requests', col: 'student_id', area: 'hostel', how: 'move' },
  { table: 'hostel_fee_gaps', col: 'student_id', area: 'hostel', how: 'move' },
  { table: 'hostel_incidents', col: 'student_id', area: 'hostel', how: 'move' },
  {
    table: 'hostel_meal_feedback',
    col: 'student_id',
    area: 'hostel',
    how: 'keep',
    key: ['meal_id', 'on_date', 'by_user'],
    rule: 'one feedback of a meal',
  },
  {
    table: 'hostel_meal_skips',
    col: 'student_id',
    area: 'hostel',
    how: 'keep',
    key: ['mark_id'],
    rule: 'one meal skip',
  },
  {
    table: 'hostel_rollcall_marks',
    col: 'student_id',
    area: 'hostel',
    how: 'keep',
    key: ['rollcall_id'],
    rule: 'the kept record’s roll-call mark',
  },
  {
    table: 'hostel_visitors',
    col: 'student_id',
    area: 'hostel',
    how: 'keep',
    key: ['mobile'],
    scope: `{a}.status IN ('pending', 'approved')`,
    rule: 'one approved visitor of a number',
  },
  { table: 'hostel_withdrawals', col: 'student_id', area: 'hostel', how: 'move' },

  // ---- health ------------------------------------------------------------------------------------
  { table: 'clinic_visits', col: 'student_id', area: 'health', how: 'move' },
  {
    table: 'health_checkups',
    col: 'student_id',
    area: 'health',
    how: 'keep',
    key: ['camp_id'],
    rule: 'the kept record’s check-up of a camp',
  },
  {
    table: 'health_records',
    col: 'student_id',
    area: 'health',
    how: 'keep',
    key: ['recorded_on', 'COALESCE({a}.exam_id, 0)'],
    rule: 'the kept record’s record of the day',
  },

  // ---- requests, messages, consents --------------------------------------------------------------
  { table: 'appointments', col: 'student_id', area: 'requests', how: 'move' },
  { table: 'cctv_requests', col: 'student_id', area: 'requests', how: 'move' },
  { table: 'consent_form_responses', col: 'student_id', area: 'requests', how: 'move' },
  { table: 'consent_otps', col: 'student_id', area: 'requests', how: 'move' },
  { table: 'consents', col: 'student_id', area: 'requests', how: 'move' },
  { table: 'gate_passes', col: 'student_id', area: 'requests', how: 'move' },
  { table: 'parent_queries', col: 'student_id', area: 'requests', how: 'move' },
  { table: 'profile_change_requests', col: 'student_id', area: 'requests', how: 'move' },
  { table: 'feedback_entries', col: 'student_id', area: 'requests', how: 'move' },
  { table: 'message_request_recipients', col: 'student_id', area: 'requests', how: 'move' },
  {
    table: 'message_request_recipients',
    col: 'person_id',
    area: 'requests',
    how: 'move',
    where: `{a}.person_type = 'student'`,
  },
  {
    table: 'comms_group_members',
    col: 'person_id',
    area: 'requests',
    how: 'keep',
    key: ['group_id'],
    where: `{a}.person_type = 'student'`,
    rule: 'one place in a group',
  },
  {
    table: 'academic_acks',
    col: 'student_id',
    area: 'requests',
    how: 'keep',
    key: ['item_type', 'item_id', 'COALESCE({a}.staff_user_id, 0)'],
    rule: 'one acknowledgement of a notice',
  },
  {
    table: 'birthday_wishes',
    col: 'person_id',
    area: 'requests',
    how: 'keep',
    key: ['on_date'],
    where: `{a}.person_kind = 'student'`,
    rule: 'one birthday wish a day',
  },

  // ---- admissions and the rest -------------------------------------------------------------------
  { table: 'applications', col: 'student_id', area: 'admissions', how: 'move' },
  { table: 'admission_no_changes', col: 'student_id', area: 'admissions', how: 'move' },
  { table: 'school_transfers', col: 'from_student_id', area: 'admissions', how: 'move' },
  { table: 'school_transfers', col: 'to_student_id', area: 'admissions', how: 'move' },
  { table: 'student_withdrawals', col: 'student_id', area: 'admissions', how: 'move' },
  { table: 'admission_cancellations', col: 'student_id', area: 'admissions', how: 'move' },
  { table: 'visitor_log', col: 'student_id', area: 'other', how: 'move' },
  {
    table: 'user_school_memberships',
    col: 'person_ref_id',
    area: 'other',
    how: 'special',
    where: `{a}.person_type = 'student'`,
  },
  // the duplicate's own history and the merge itself stay with it
  { table: 'student_status_history', col: 'student_id', area: 'other', how: 'leave' },
  { table: 'student_merges', col: 'keep_id', area: 'other', how: 'leave' },
  { table: 'student_merges', col: 'duplicate_id', area: 'other', how: 'leave' },
  { table: 'students', col: 'merged_into_id', area: 'other', how: 'leave' },
];

/**
 * Open matters the duplicate must not carry into the merge (settle or withdraw them first), and things
 * both records cannot hold at once. $1 = the record kept, $2 = the duplicate.
 */
export const MERGE_BLOCKERS: Array<{ sql: string; why: string }> = [
  {
    sql: `SELECT 1 FROM student_corrections WHERE student_id = $2 AND status = 'pending'`,
    why: 'The duplicate has a detail correction waiting for approval',
  },
  {
    sql: `SELECT 1 FROM class_corrections WHERE student_id = $2 AND status = 'pending'`,
    why: 'The duplicate has a class correction waiting for approval',
  },
  {
    sql: `SELECT 1 FROM fee_profile_changes WHERE student_id = $2 AND status = 'pending'`,
    why: 'The duplicate has a fee change waiting for approval',
  },
  {
    sql: `SELECT 1 FROM transport_requests WHERE student_id = $2 AND status = 'pending'`,
    why: 'The duplicate has a transport request waiting',
  },
  {
    sql: `SELECT 1 FROM student_withdrawals WHERE student_id = $2 AND status IN ('requested', 'cleared')`,
    why: 'The duplicate has a withdrawal in progress',
  },
  {
    sql: `SELECT 1 FROM admission_cancellations WHERE student_id = $2 AND status = 'pending'`,
    why: 'The duplicate has an admission cancellation waiting for approval',
  },
  {
    sql: `SELECT 1 FROM hostel_withdrawals WHERE student_id = $2 AND status IN ('requested', 'cleared')`,
    why: 'The duplicate has a hostel withdrawal in progress',
  },
  {
    sql: `SELECT 1 FROM hostel_exit_requests WHERE student_id = $2 AND status = 'pending'`,
    why: 'The duplicate has a hostel exit request waiting',
  },
  {
    sql: `SELECT 1 FROM school_transfers WHERE from_student_id = $2 AND status = 'requested'`,
    why: 'The duplicate has a transfer to another school in progress',
  },
  {
    sql: `SELECT 1 FROM hostel_allotments a JOIN hostel_allotments b ON b.student_id = $2 AND b.to_date IS NULL
           WHERE a.student_id = $1 AND a.to_date IS NULL`,
    why: 'Both records hold a hostel bed now: vacate the duplicate’s bed first',
  },
  {
    sql: `SELECT 1 FROM fee_carry_forwards a JOIN fee_carry_forwards b ON b.student_id = $2 AND b.to_year_id = a.to_year_id AND b.undone_at IS NULL
           WHERE a.student_id = $1 AND a.undone_at IS NULL`,
    why: 'Both records had last year’s balance carried into the same year: undo the duplicate’s carry-forward first',
  },
  {
    sql: `SELECT 1 FROM fee_refunds a JOIN fee_refunds b ON b.student_id = $2 AND b.academic_year_id = a.academic_year_id AND b.kind = 'opening_advance' AND b.status IN ('requested', 'approved')
           WHERE a.student_id = $1 AND a.kind = 'opening_advance' AND a.status IN ('requested', 'approved')`,
    why: 'Both records have an advance refund in progress for the same year',
  },
  {
    sql: `SELECT 1 FROM misc_fee_students a JOIN misc_fee_students b ON b.student_id = $2 AND b.misc_fee_id = a.misc_fee_id
           WHERE a.student_id = $1`,
    why: 'The same other fee (misc fee) is charged to both: remove it from the duplicate first',
  },
  {
    sql: `SELECT 1 FROM fee_demands d JOIN fee_demands k ON k.student_id = $1 AND k.academic_year_id = d.academic_year_id AND k.period_id = d.period_id AND k.head_id = d.head_id
           WHERE d.student_id = $2 AND EXISTS (SELECT 1 FROM fee_adjustments a WHERE a.demand_id = d.id OR a.charge_demand_id = d.id)`,
    why: 'A fee line both records are charged for has a waiver or adjustment on the duplicate: undo it first',
  },
];
