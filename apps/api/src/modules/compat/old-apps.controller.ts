import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { DbService } from '../../common/db/db.service';
import { ReqCtx, requireTenant, type RequestContext } from '../../common/http/request-context';
import { PLATFORM } from '../platform/platform.permissions';

/**
 * Who still uses the old school apps (the compat API) and who uses the one EduPro app, so the school knows when its
 * people have moved (docs/design/89 phase D; ADR-015: the compat API stays until then). From the sign-in log: the old
 * apps' handshakes (with the user type the old app sent) and the EduPro app's sign-ins.
 */
@ApiTags('platform')
@ApiBearerAuth()
@Controller('platform/old-apps')
export class OldAppsController {
  constructor(private readonly db: DbService) {}

  @Get()
  @RequirePermission(PLATFORM.settingsView)
  @ApiOperation({ summary: 'People on the old school apps and on the EduPro app (7 and 30 days)' })
  usage(@ReqCtx() ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const old = await c.query<{ type: string; week: number; month: number }>(
        `SELECT COALESCE(NULLIF(detail->>'type', ''), 'unknown') AS type,
                count(DISTINCT detail->>'legacyUser') FILTER (WHERE occurred_at > now() - interval '7 days')::int AS week,
                count(DISTINCT detail->>'legacyUser')::int AS month
           FROM login_events
          WHERE method = 'compat' AND outcome = 'success' AND school_id = app.current_school_id()
            AND occurred_at > now() - interval '30 days'
          GROUP BY 1 ORDER BY 1`,
      );
      const app = await c.query<{ week: number; month: number }>(
        `SELECT count(DISTINCT user_id) FILTER (WHERE occurred_at > now() - interval '7 days')::int AS week,
                count(DISTINCT user_id)::int AS month
           FROM login_events
          WHERE detail->>'app' = 'mobile' AND outcome = 'success' AND school_id = app.current_school_id()
            AND occurred_at > now() - interval '30 days'`,
      );
      return {
        oldApps: old.rows,
        oldAppsTotal: {
          week: old.rows.reduce((n, r) => n + r.week, 0),
          month: old.rows.reduce((n, r) => n + r.month, 0),
        },
        edupro: app.rows[0] ?? { week: 0, month: 0 },
      };
    });
  }
}
