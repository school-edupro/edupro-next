import { createHash } from 'node:crypto';
import type { PoolClient } from '@edupro/db';

/**
 * Enquiries and registrations (docs/design/39, part 8): the invitation token, and the registration that
 * converts an enquiry — the one started from its link, or the first registration with the same mobile or
 * email within a year.
 */

export const enquiryTokenHash = (token: string) =>
  createHash('sha256').update(`enquiry:${token}`).digest('hex');

/** A registration started from an invitation link: the enquiry is linked and its child's details start the form. */
export async function startFromEnquiry(
  c: PoolClient,
  appId: string,
  token: string,
): Promise<{ childName: string | null; childDob: string | null } | null> {
  const e = await c.query<{ id: string; child_name: string | null; child_dob: string | null }>(
    `SELECT id::text, child_name, child_dob::text FROM admission_enquiries
      WHERE invite_token_hash = $1 AND status <> 'closed' AND application_id IS NULL`,
    [enquiryTokenHash(token)],
  );
  const x = e.rows[0];
  if (!x) return null;
  await c.query(`UPDATE applications SET enquiry_id = $2 WHERE id = $1 AND enquiry_id IS NULL`, [
    appId,
    x.id,
  ]);
  await c.query(
    `INSERT INTO admission_enquiry_followups (school_id, enquiry_id, mode, outcome) VALUES (app.current_school_id(), $1, 'system', 'The family started the registration form from the invitation')`,
    [x.id],
  );
  return { childName: x.child_name, childDob: x.child_dob };
}

/** A registration made: the enquiry it came from (or one with the same mobile or email) is converted. */
export async function convertEnquiry(c: PoolClient, appId: string): Promise<void> {
  const a = await c.query<{
    enquiry_id: string | null;
    mobile: string | null;
    email: string | null;
    number: string | null;
    class_id: string;
  }>(
    `SELECT a.enquiry_id::text, COALESCE(a.contact_mobile, ap.mobile) AS mobile, lower(COALESCE(a.contact_email, ap.email::text)) AS email,
            a.application_no AS number, a.class_id::text
       FROM applications a JOIN applicants ap ON ap.id = a.applicant_id WHERE a.id = $1`,
    [appId],
  );
  const x = a.rows[0];
  if (!x) return;
  let enquiryId = x.enquiry_id;
  if (!enquiryId) {
    const found = await c.query<{ id: string }>(
      `SELECT id::text FROM admission_enquiries
        WHERE application_id IS NULL AND status NOT IN ('converted', 'closed') AND created_at > now() - interval '365 days'
          AND (($1::text IS NOT NULL AND mobile = $1) OR ($2::text IS NOT NULL AND lower(email::text) = $2))
        ORDER BY (class_id = $3::bigint) DESC NULLS LAST, created_at DESC LIMIT 1`,
      [x.mobile, x.email, x.class_id],
    );
    enquiryId = found.rows[0]?.id ?? null;
    if (enquiryId)
      await c.query(`UPDATE applications SET enquiry_id = $2 WHERE id = $1`, [appId, enquiryId]);
  }
  if (!enquiryId) return;
  await c.query(
    `UPDATE admission_enquiries SET status = 'converted', application_id = $2, converted_at = now(), next_follow_up_on = NULL, updated_at = now()
      WHERE id = $1 AND application_id IS NULL`,
    [enquiryId, appId],
  );
  await c.query(
    `INSERT INTO admission_enquiry_followups (school_id, enquiry_id, mode, outcome, status_after) VALUES (app.current_school_id(), $1, 'system', $2, 'converted')`,
    [enquiryId, `Registered: ${x.number ?? ''}`],
  );
}
