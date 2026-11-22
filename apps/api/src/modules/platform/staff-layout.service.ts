import { Injectable } from '@nestjs/common';
import {
  DEFAULT_STAFF_LAYOUT,
  STAFF_CARDS,
  STAFF_MENU,
  staffMenuOf,
  STAFF_LAYOUT_LIMITS,
  checkStaffLayout,
  myStaffLayout,
  staffLayoutScreens,
  type StaffLayout,
} from '@edupro/menus';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import {
  requireTenant,
  type ContextualRequest,
  type RequestContext,
} from '../../common/http/request-context';
import { AccessService } from '../access/access.service';
import { StaffWaitingService } from '../me/staff-waiting.service';
import type { StaffLayoutDto } from './staff-layout.dto';

interface LayoutRow {
  draft: StaffLayout;
  draftUpdatedAt: string;
  draftUpdatedBy: string | null;
  published: StaffLayout | null;
  publishedAt: string | null;
  publishedBy: string | null;
}

const AUDIENCE = 'staff';
const PREF = 'staff.shortcuts';

/** The lists in a fixed order (so two layouts compare by their JSON). */
const tidy = (l: StaffLayout): StaffLayout => ({
  tabs: [...l.tabs],
  shortcuts: [...l.shortcuts],
  cards: [...l.cards],
  // a layout kept before the menu was arranged has none: the menu as built
  menu: staffMenuOf(l),
  hidden: [...(l.hidden ?? [])],
});
const same = (x: StaffLayout, y: StaffLayout) =>
  JSON.stringify(tidy(x)) === JSON.stringify(tidy(y));

/**
 * The staff app's layout kept by the school (0413, docs/design/94): the office edits a draft and publishes it on System
 * settings → Staff app layout; a staff member gets the published one (or the standard one) with their rights and the
 * work waiting on them applied, and their own Home shortcuts.
 */
@Injectable()
export class StaffLayoutService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly waiting: StaffWaitingService,
  ) {}

  // ------------------------------------------------------------------------------------------ the office

  /** The draft and published layout, what changed, and the catalogue the editor offers. */
  async setup(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await this.row(c);
      const live = r?.published ?? DEFAULT_STAFF_LAYOUT;
      const draft = r?.draft ?? DEFAULT_STAFF_LAYOUT;
      return {
        draft: tidy(draft),
        published: tidy(live),
        everPublished: !!r?.published,
        publishedAt: r?.publishedAt ?? null,
        publishedBy: r?.publishedBy ?? null,
        draftUpdatedAt: r ? r.draftUpdatedAt : null,
        draftUpdatedBy: r?.draftUpdatedBy ?? null,
        changed: !same(draft, live),
        catalogue: {
          screens: staffLayoutScreens(),
          cards: STAFF_CARDS,
          // the menu groups' standard names (Home stays first and is not one)
          groups: STAFF_MENU.map((g) => ({ key: g.id, label: g.label })),
          limits: STAFF_LAYOUT_LIMITS,
          defaults: DEFAULT_STAFF_LAYOUT,
        },
      };
    });
  }

  /** The draft saved (checked first); staff see nothing until it is published. */
  async saveDraft(ctx: RequestContext, dto: StaffLayoutDto) {
    const problems = checkStaffLayout(dto);
    if (problems.length)
      throw new DomainError('validation-failed', problems.join(' '), {
        status: 400,
        extra: { errors: problems },
      });
    const layout = tidy(dto);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const before = await this.row(c);
      await c.query(
        `INSERT INTO family_app_layouts (school_id, audience, draft, draft_updated_by, draft_updated_at)
         VALUES (app.current_school_id(), $1, $2::jsonb, app.current_user_id(), now())
         ON CONFLICT (school_id, audience) DO UPDATE
           SET draft = EXCLUDED.draft, draft_updated_by = EXCLUDED.draft_updated_by, draft_updated_at = now()`,
        [AUDIENCE, JSON.stringify(layout)],
      );
      await this.audit.stage(ctx, c, {
        action: 'platform.staff_layout.draft_saved',
        entityType: 'family_app_layouts',
        entityId: AUDIENCE,
        before: before?.draft ?? DEFAULT_STAFF_LAYOUT,
        after: layout,
      });
      return { ok: true };
    });
  }

  /** The draft becomes what staff get (on their next refresh). */
  async publish(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const before = await this.row(c);
      const layout = tidy(before?.draft ?? DEFAULT_STAFF_LAYOUT);
      await c.query(
        `INSERT INTO family_app_layouts (school_id, audience, draft, draft_updated_by, published, published_by, published_at)
         VALUES (app.current_school_id(), $1, $2::jsonb, app.current_user_id(), $2::jsonb, app.current_user_id(), now())
         ON CONFLICT (school_id, audience) DO UPDATE
           SET published = EXCLUDED.published, published_by = EXCLUDED.published_by, published_at = now()`,
        [AUDIENCE, JSON.stringify(layout)],
      );
      await this.audit.stage(ctx, c, {
        action: 'platform.staff_layout.published',
        entityType: 'family_app_layouts',
        entityId: AUDIENCE,
        before: before?.published ?? DEFAULT_STAFF_LAYOUT,
        after: layout,
      });
      return { ok: true };
    });
  }

  /** The draft goes back to what staff have now. */
  async discard(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const before = await this.row(c);
      if (!before) return { ok: true };
      const live = tidy(before.published ?? DEFAULT_STAFF_LAYOUT);
      await c.query(
        `UPDATE family_app_layouts SET draft = $2::jsonb, draft_updated_by = app.current_user_id(), draft_updated_at = now()
          WHERE audience = $1`,
        [AUDIENCE, JSON.stringify(live)],
      );
      await this.audit.stage(ctx, c, {
        action: 'platform.staff_layout.draft_discarded',
        entityType: 'family_app_layouts',
        entityId: AUDIENCE,
        before: before.draft,
        after: live,
      });
      return { ok: true };
    });
  }

  // ------------------------------------------------------------------------------------------ staff

  /**
   * The layout a staff member gets: the published one (else the standard), their rights and work applied — with the
   * counts behind it (unread messages, the work waiting), so the staff website reads its frame in one call.
   */
  async mine(ctx: RequestContext, req: ContextualRequest) {
    const tenant = requireTenant(ctx);
    const [permissions, { waiting, unread }] = await Promise.all([
      this.access.effectivePermissions(tenant).then((p) => [...p]),
      this.waiting.count(req),
    ]);
    return this.db.tenant(tenant, async (c) => {
      const r = await this.row(c);
      const own = await this.own(c);
      return {
        ...myStaffLayout(permissions, waiting, r?.published ?? DEFAULT_STAFF_LAYOUT, own),
        // never published: the staff website keeps its menu and phone bar as built
        published: !!r?.published,
        waiting,
        unread,
      };
    });
  }

  /** The published staff layout (null: never published — the menu as built). */
  async published(ctx: RequestContext): Promise<StaffLayout | null> {
    return this.db.tenant(requireTenant(ctx), async (c) => (await this.row(c))?.published ?? null);
  }

  /** A staff member's own Home shortcuts (4 to 12 screens they can open), kept for them in this school. */
  async saveMine(ctx: RequestContext, req: ContextualRequest, shortcuts: string[]) {
    const tenant = requireTenant(ctx);
    const [permissions, { waiting }] = await Promise.all([
      this.access.effectivePermissions(tenant).then((p) => [...p]),
      this.waiting.count(req),
    ]);
    const live =
      (await this.db.tenant(tenant, (c) => this.row(c)))?.published ?? DEFAULT_STAFF_LAYOUT;
    const open = new Set(
      myStaffLayout(permissions, waiting, live, null).screens.map((s) => s.href),
    );
    const problems: string[] = [];
    if (
      shortcuts.length < STAFF_LAYOUT_LIMITS.shortcuts.min ||
      shortcuts.length > STAFF_LAYOUT_LIMITS.shortcuts.max
    )
      problems.push('Choose 4 to 12 shortcuts.');
    if (new Set(shortcuts).size !== shortcuts.length) problems.push('A shortcut is chosen twice.');
    for (const s of shortcuts)
      if (!open.has(s)) problems.push(`${s} is not a screen you can open.`);
    if (problems.length)
      throw new DomainError('validation-failed', problems.join(' '), {
        status: 400,
        extra: { errors: problems },
      });
    await this.db.tenant(tenant, (c) =>
      c.query(
        `INSERT INTO user_preferences (school_id, user_id, pref_key, value)
         VALUES (app.current_school_id(), app.current_user_id(), $1, $2::jsonb)
         ON CONFLICT (school_id, user_id, pref_key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [PREF, JSON.stringify({ shortcuts })],
      ),
    );
    return this.mine(ctx, req);
  }

  /** Back to the school's shortcuts. */
  async resetMine(ctx: RequestContext, req: ContextualRequest) {
    await this.db.tenant(requireTenant(ctx), (c) =>
      c.query(
        `DELETE FROM user_preferences WHERE user_id = app.current_user_id() AND pref_key = $1`,
        [PREF],
      ),
    );
    return this.mine(ctx, req);
  }

  // ------------------------------------------------------------------------------------------ helpers

  private async row(c: PoolClient): Promise<LayoutRow | undefined> {
    const r = await c.query<LayoutRow>(
      `SELECT l.draft, l.draft_updated_at AS "draftUpdatedAt", du.display_name AS "draftUpdatedBy",
              l.published, l.published_at AS "publishedAt", pu.display_name AS "publishedBy"
         FROM family_app_layouts l
         LEFT JOIN users du ON du.id = l.draft_updated_by
         LEFT JOIN users pu ON pu.id = l.published_by
        WHERE l.audience = $1`,
      [AUDIENCE],
    );
    return r.rows[0];
  }

  private async own(c: PoolClient): Promise<string[] | null> {
    const r = await c.query<{ value: { shortcuts?: unknown } }>(
      `SELECT value FROM user_preferences WHERE user_id = app.current_user_id() AND pref_key = $1`,
      [PREF],
    );
    const list = r.rows[0]?.value?.shortcuts;
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : null;
  }
}
