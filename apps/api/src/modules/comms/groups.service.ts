import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import type { CreateGroupDto, GroupMembersDto } from './comms.dto';

export interface GroupRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  members: number;
  createdAt: string;
}

/** Communication groups (S10): named sets of users a message request can target. */
@Injectable()
export class GroupsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async list(ctx: RequestContext): Promise<GroupRow[]> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{
        id: string;
        code: string;
        name: string;
        description: string | null;
        members: number;
        created_at: Date;
      }>(
        `SELECT g.id::text, g.code, g.name, g.description, (SELECT count(*)::int FROM comms_group_members m WHERE m.group_id = g.id) AS members, g.created_at
           FROM comms_groups g WHERE g.deleted_at IS NULL ORDER BY g.name`,
      );
      return r.rows.map((x) => ({
        id: x.id,
        code: x.code,
        name: x.name,
        description: x.description,
        members: x.members,
        createdAt: x.created_at.toISOString(),
      }));
    });
  }

  async members(ctx: RequestContext, groupId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{
        id: string;
        name: string;
        mobile: string | null;
        email: string | null;
      }>(
        `SELECT u.id::text, u.display_name AS name, u.mobile, u.email FROM comms_group_members m JOIN users u ON u.id = m.user_id WHERE m.group_id = $1 ORDER BY u.display_name`,
        [groupId],
      );
      return r.rows;
    });
  }

  async create(ctx: RequestContext, dto: CreateGroupDto): Promise<GroupRow> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      let id: string;
      try {
        const r = await c.query<{ id: string }>(
          `INSERT INTO comms_groups (school_id, code, name, description, created_by) VALUES (app.current_school_id(), $1, $2, $3, app.current_user_id()) RETURNING id::text`,
          [dto.code, dto.name, dto.description ?? null],
        );
        id = r.rows[0]!.id;
      } catch (error) {
        if ((error as { code?: string }).code === '23505')
          throw new DomainError('conflict', `Group "${dto.code}" already exists`);
        throw error;
      }
      if (dto.userIds.length) await this.addMembers(c, id, dto.userIds);
      await this.audit.stage(ctx, c, {
        action: 'comms.group.create',
        entityType: 'comms_groups',
        entityId: id,
        after: { code: dto.code, name: dto.name, members: dto.userIds.length },
      });
      const row = await c.query<{ members: number }>(
        `SELECT (SELECT count(*)::int FROM comms_group_members m WHERE m.group_id = $1) AS members`,
        [id],
      );
      return {
        id,
        code: dto.code,
        name: dto.name,
        description: dto.description ?? null,
        members: row.rows[0]!.members,
        createdAt: new Date().toISOString(),
      };
    });
  }

  async updateMembers(ctx: RequestContext, groupId: string, dto: GroupMembersDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const g = await c.query(`SELECT 1 FROM comms_groups WHERE id = $1 AND deleted_at IS NULL`, [
        groupId,
      ]);
      if (!g.rowCount) throw new DomainError('not-found', 'Group not found', { status: 404 });
      if (dto.add.length) await this.addMembers(c, groupId, dto.add);
      if (dto.remove.length)
        await c.query(
          `DELETE FROM comms_group_members WHERE group_id = $1 AND user_id = ANY($2::bigint[])`,
          [groupId, dto.remove],
        );
      await this.audit.stage(ctx, c, {
        action: 'comms.group.members',
        entityType: 'comms_groups',
        entityId: groupId,
        after: { added: dto.add.length, removed: dto.remove.length },
      });
      const r = await c.query<{
        id: string;
        name: string;
        mobile: string | null;
        email: string | null;
      }>(
        `SELECT u.id::text, u.display_name AS name, u.mobile, u.email FROM comms_group_members m JOIN users u ON u.id = m.user_id WHERE m.group_id = $1 ORDER BY u.display_name`,
        [groupId],
      );
      return { members: r.rows };
    });
  }

  private async addMembers(
    c: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
    groupId: string,
    userIds: string[],
  ) {
    await c.query(
      `INSERT INTO comms_group_members (school_id, group_id, user_id, added_by)
       SELECT app.current_school_id(), $1, u.id, app.current_user_id() FROM users u
        WHERE u.id = ANY($2::bigint[]) AND EXISTS (SELECT 1 FROM user_school_memberships m WHERE m.user_id = u.id AND m.school_id = app.current_school_id() AND m.deleted_at IS NULL)
       ON CONFLICT (group_id, user_id) DO NOTHING`,
      [groupId, userIds],
    );
  }
}
