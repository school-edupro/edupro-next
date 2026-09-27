import { Injectable } from '@nestjs/common';
import { DbService } from '../../common/db/db.service';
import type { AuthenticatedUser } from '../../common/http/request-context';

type ResolvedUser = Omit<AuthenticatedUser, 'mfa' | 'authTime' | 'dev'>;

/**
 * Resolves One Auth identities to EduPro users and their school memberships. Runs before any school is
 * selected, so it uses the auth-lookup transaction (policy users_auth_lookup, user_school_memberships_self).
 */
@Injectable()
export class IdentityService {
  constructor(private readonly db: DbService) {}

  async resolveBySub(
    sub: string,
    claims: { mobile?: string | null } = {},
  ): Promise<ResolvedUser | null> {
    return this.db.authLookup(sub, async (c) => {
      let user = await c.query<{ id: string; display_name: string; status: string }>(
        `SELECT id::text, display_name, status FROM users WHERE oneauth_sub = $1 AND deleted_at IS NULL`,
        [sub],
      );
      if (!user.rows[0] && claims.mobile) {
        // First login of an invited user: claim the 'pending:<mobile>' row created by app.invite_user.
        const claimed = await c.query<{ id: string | null }>(
          `SELECT app.claim_pending_identity($1, $2)::text AS id`,
          [claims.mobile.replace(/\D/g, '').slice(-10), sub],
        );
        if (claimed.rows[0]?.id) {
          user = await c.query<{ id: string; display_name: string; status: string }>(
            `SELECT id::text, display_name, status FROM users WHERE oneauth_sub = $1 AND deleted_at IS NULL`,
            [sub],
          );
        }
      }
      const row = user.rows[0];
      if (!row || row.status !== 'active') return null;

      // Make the caller visible to the membership policy for the rest of this transaction.
      await c.query(`SELECT set_config('app.user_id', $1, true)`, [row.id]);

      const memberships = await c.query<{
        school_id: string;
        person_type: string;
        school_code: string;
        school_name: string;
      }>(
        `SELECT m.school_id::text, m.person_type, s.code AS school_code, s.name AS school_name
         FROM user_school_memberships m
         JOIN schools s ON s.id = m.school_id
         WHERE m.user_id = $1 AND m.status = 'active' AND m.deleted_at IS NULL AND s.status = 'active'
         ORDER BY s.name`,
        [row.id],
      );

      await c.query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [row.id]);

      return {
        id: row.id,
        sub,
        displayName: row.display_name,
        memberships: memberships.rows.map((m) => ({
          schoolId: m.school_id,
          schoolCode: m.school_code,
          schoolName: m.school_name,
          personType: m.person_type,
        })),
      };
    });
  }

  /** Validates an impersonation session before any tenant context exists (S5-02, SECURITY DEFINER lookup). */
  async impersonationCheck(sessionId: string): Promise<{
    schoolId: string;
    actorUserId: string;
    targetUserId: string;
    actorName: string;
    expiresAt: Date;
    endedAt: Date | null;
  } | null> {
    if (!/^[0-9]{1,18}$/.test(sessionId)) return null;
    return this.db.global(async (c) => {
      const r = await c.query<{
        o_school_id: string;
        o_actor_user_id: string;
        o_target_user_id: string;
        o_actor_name: string;
        o_expires_at: Date;
        o_ended_at: Date | null;
      }>(
        'SELECT o_school_id::text, o_actor_user_id::text, o_target_user_id::text, o_actor_name, o_expires_at, o_ended_at FROM app.impersonation_check($1)',
        [sessionId],
      );
      const row = r.rows[0];
      return row
        ? {
            schoolId: row.o_school_id,
            actorUserId: row.o_actor_user_id,
            targetUserId: row.o_target_user_id,
            actorName: row.o_actor_name,
            expiresAt: row.o_expires_at,
            endedAt: row.o_ended_at,
          }
        : null;
    });
  }
}
