/**
 * Whether a registration (`a`, joined to applications) is among the families a notice for candidates is
 * for (docs/design/43, part 2): its admission session, the classes sought and the registration statuses
 * chosen, matched live — a notice to "Registration fee due" stops reaching a family once it has paid.
 * A notice without a session (written before) reaches the open sessions; no class means every class;
 * no status means every registration but cancelled and withdrawn ones. `nid` is the notice's id (SQL).
 */
// eslint-disable-next-line no-restricted-syntax -- nid is a fixed SQL expression ('$1', 'n.id'), never a value
export const candidateNoticeMatch = (nid: string) => `(
  (EXISTS (SELECT 1 FROM notice_targets t WHERE t.notice_id = ${nid} AND t.target_type = 'admission_cycle' AND t.target_id = a.cycle_id)
   OR (NOT EXISTS (SELECT 1 FROM notice_targets t WHERE t.notice_id = ${nid} AND t.target_type = 'admission_cycle')
       AND EXISTS (SELECT 1 FROM admission_cycles oy WHERE oy.id = a.cycle_id AND oy.status = 'open' AND oy.deleted_at IS NULL)))
  AND (NOT EXISTS (SELECT 1 FROM notice_targets t WHERE t.notice_id = ${nid} AND t.target_type = 'admission_class')
       OR EXISTS (SELECT 1 FROM notice_targets t WHERE t.notice_id = ${nid} AND t.target_type = 'admission_class' AND t.target_id = a.class_id))
  AND EXISTS (SELECT 1 FROM notices ns WHERE ns.id = ${nid}
              AND (CASE WHEN ns.candidate_statuses IS NULL THEN a.status::text NOT IN ('cancelled', 'withdrawn')
                        ELSE a.status::text = ANY(ns.candidate_statuses) END)))`;

/** The statuses a notice for candidates may pick (the same list as Compose's Candidates). */
export const CANDIDATE_NOTICE_STATUSES = [
  'draft',
  'submitted',
  'registered',
  'under_review',
  'sent_back',
  'waitlisted',
  'offered',
  'fee_paid',
  'admitted',
  'rejected',
] as const;
