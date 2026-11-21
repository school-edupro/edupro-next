import { Injectable } from '@nestjs/common';
import {
  DEFAULT_FAMILY_LAYOUT,
  FAMILY_CARDS,
  LAYOUT_LIMITS,
  checkFamilyLayout,
  familyLayoutScreens,
  myFamilyLayout,
  type Audience,
  type FamilyLayout,
} from '@edupro/menus';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { AccessService } from '../access/access.service';
import type { FamilyLayoutDto } from './family-layout.dto';

interface LayoutRow {
  draft: FamilyLayout;
  draftUpdatedAt: string;
  draftUpdatedBy: string | null;
  published: FamilyLayout | null;
  publishedAt: string | null;
  publishedBy: string | null;
}

const AUDIENCES: Audience[] = ['student', 'parent'];
const prefKey = (a: Audience) => `family.shortcuts.${a}`;

/** The four lists in a fixed order (so two layouts compare by their JSON). */
const tidy = (l: FamilyLayout): FamilyLayout => ({
  tabs: [...l.tabs],
  shortcuts: [...l.shortcuts],
  cards: [...l.cards],
  academics: [...l.academics],
});
const same = (a: FamilyLayout, b: FamilyLayout) =>
  JSON.stringify(tidy(a)) === JSON.stringify(tidy(b));

/**
 * The family app's layout kept by the school (0407, docs/design/90): the office edits a draft per audience and
 * publishes it on System settings; a student or parent gets the published one (or the app as it was) with their rights
 * applied and their own Home shortcuts.
 */
@Injectable()
export class FamilyLayoutService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
  ) {}

  // ------------------------------------------------------------------------------------------ the office

  /** Both audiences' draft and published layout, what changed, and the catalogue the editor offers. */
  async setup(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const layouts = Object.fromEntries(
        await Promise.all(
          AUDIENCES.map(async (a) => {
            const r = await this.row(c, a);
            const live = r?.published ?? DEFAULT_FAMILY_LAYOUT[a];
            const draft = r?.draft ?? DEFAULT_FAMILY_LAYOUT[a];
            return [
              a,
              {
                draft: tidy(draft),
                published: tidy(live),
                // never published: families get the app as it was
                everPublished: !!r?.published,
                publishedAt: r?.publishedAt ?? null,
                publishedBy: r?.publishedBy ?? null,
                draftUpdatedAt: r ? r.draftUpdatedAt : null,
                draftUpdatedBy: r?.draftUpdatedBy ?? null,
                changed: !same(draft, live),
              },
            ] as const;
          }),
        ),
      );
      return {
        layouts,
        catalogue: {
          screens: {
            student: familyLayoutScreens('student'),
            parent: familyLayoutScreens('parent'),
          },
          cards: FAMILY_CARDS,
          limits: LAYOUT_LIMITS,
          defaults: DEFAULT_FAMILY_LAYOUT,
        },
      };
    });
  }

  /** The draft saved (checked first); families see nothing until it is published. */
  async saveDraft(ctx: RequestContext, audience: Audience, dto: FamilyLayoutDto) {
    const layout = tidy(dto);
    const problems = checkFamilyLayout(audience, layout);
    if (problems.length)
      throw new DomainError('validation-failed', problems.join(' '), {
        status: 400,
        extra: { errors: problems },
      });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const before = await this.row(c, audience);
      await c.query(
        `INSERT INTO family_app_layouts (school_id, audience, draft, draft_updated_by, draft_updated_at)
         VALUES (app.current_school_id(), $1, $2::jsonb, app.current_user_id(), now())
         ON CONFLICT (school_id, audience) DO UPDATE
           SET draft = EXCLUDED.draft, draft_updated_by = EXCLUDED.draft_updated_by, draft_updated_at = now()`,
        [audience, JSON.stringify(layout)],
      );
      await this.audit.stage(ctx, c, {
        action: 'platform.family_layout.draft_saved',
        entityType: 'family_app_layouts',
        entityId: audience,
        before: before?.draft ?? DEFAULT_FAMILY_LAYOUT[audience],
        after: layout,
      });
      return { ok: true };
    });
  }

  /** The draft becomes what families get (on their next refresh). */
  async publish(ctx: RequestContext, audience: Audience) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const before = await this.row(c, audience);
      const layout = tidy(before?.draft ?? DEFAULT_FAMILY_LAYOUT[audience]);
      await c.query(
        `INSERT INTO family_app_layouts (school_id, audience, draft, draft_updated_by, published, published_by, published_at)
         VALUES (app.current_school_id(), $1, $2::jsonb, app.current_user_id(), $2::jsonb, app.current_user_id(), now())
         ON CONFLICT (school_id, audience) DO UPDATE
           SET published = EXCLUDED.published, published_by = EXCLUDED.published_by, published_at = now()`,
        [audience, JSON.stringify(layout)],
      );
      await this.audit.stage(ctx, c, {
        action: 'platform.family_layout.published',
        entityType: 'family_app_layouts',
        entityId: audience,
        before: before?.published ?? DEFAULT_FAMILY_LAYOUT[audience],
        after: layout,
      });
      return { ok: true };
    });
  }

  /** The draft goes back to what families have now. */
  async discard(ctx: RequestContext, audience: Audience) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const before = await this.row(c, audience);
      if (!before) return { ok: true };
      const live = tidy(before.published ?? DEFAULT_FAMILY_LAYOUT[audience]);
      await c.query(
        `UPDATE family_app_layouts SET draft = $2::jsonb, draft_updated_by = app.current_user_id(), draft_updated_at = now()
          WHERE audience = $1`,
        [audience, JSON.stringify(live)],
      );
      await this.audit.stage(ctx, c, {
        action: 'platform.family_layout.draft_discarded',
        entityType: 'family_app_layouts',
        entityId: audience,
        before: before.draft,
        after: live,
      });
      return { ok: true };
    });
  }

  // ------------------------------------------------------------------------------------------ families

  /** The layout a student or parent gets: the published one, their rights applied, their own shortcuts. */
  async mine(ctx: RequestContext, audience: Audience) {
    const tenant = requireTenant(ctx);
    const permissions = [...(await this.access.effectivePermissions(tenant))];
    return this.db.tenant(tenant, async (c) => {
      const r = await this.row(c, audience);
      const own = await this.own(c, audience);
      return {
        ...myFamilyLayout(
          audience,
          permissions,
          r?.published ?? DEFAULT_FAMILY_LAYOUT[audience],
          own,
        ),
        // never published: the app keeps its own layout (the same) and the website its old Home
        published: !!r?.published,
      };
    });
  }

  /** A person's own Home shortcuts (4 to 12 screens they can open), kept for them in this school. */
  async saveMine(ctx: RequestContext, audience: Audience, shortcuts: string[]) {
    const tenant = requireTenant(ctx);
    const permissions = [...(await this.access.effectivePermissions(tenant))];
    const open = new Set(
      myFamilyLayout(audience, permissions, DEFAULT_FAMILY_LAYOUT[audience], null).screens.map(
        (s) => s.href,
      ),
    );
    const problems: string[] = [];
    if (
      shortcuts.length < LAYOUT_LIMITS.shortcuts.min ||
      shortcuts.length > LAYOUT_LIMITS.shortcuts.max
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
        [prefKey(audience), JSON.stringify({ shortcuts })],
      ),
    );
    return this.mine(ctx, audience);
  }

  /** Back to the school's shortcuts. */
  async resetMine(ctx: RequestContext, audience: Audience) {
    await this.db.tenant(requireTenant(ctx), (c) =>
      c.query(
        `DELETE FROM user_preferences WHERE user_id = app.current_user_id() AND pref_key = $1`,
        [prefKey(audience)],
      ),
    );
    return this.mine(ctx, audience);
  }

  // ------------------------------------------------------------------------------------------ helpers

  private async row(c: PoolClient, audience: Audience): Promise<LayoutRow | undefined> {
    const r = await c.query<LayoutRow>(
      `SELECT l.draft, l.draft_updated_at AS "draftUpdatedAt", du.display_name AS "draftUpdatedBy",
              l.published, l.published_at AS "publishedAt", pu.display_name AS "publishedBy"
         FROM family_app_layouts l
         LEFT JOIN users du ON du.id = l.draft_updated_by
         LEFT JOIN users pu ON pu.id = l.published_by
        WHERE l.audience = $1`,
      [audience],
    );
    return r.rows[0];
  }

  private async own(c: PoolClient, audience: Audience): Promise<string[] | null> {
    const r = await c.query<{ value: { shortcuts?: unknown } }>(
      `SELECT value FROM user_preferences WHERE user_id = app.current_user_id() AND pref_key = $1`,
      [prefKey(audience)],
    );
    const list = r.rows[0]?.value?.shortcuts;
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : null;
  }
}
