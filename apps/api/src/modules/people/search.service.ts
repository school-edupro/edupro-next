import { Injectable } from '@nestjs/common';
import { ScopePolicy } from '../../common/access/scope.policy';
import { DbService } from '../../common/db/db.service';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { PEOPLE } from './people.permissions';

export interface SearchHit {
  kind: 'student' | 'guardian' | 'employee';
  id: string;
  displayName: string;
  subtitle: string;
  rank: number;
}

/** People search (S4-07) over app.search_people; students outside a class teacher's scope are dropped. */
@Injectable()
export class SearchService {
  constructor(
    private readonly db: DbService,
    private readonly scopes: ScopePolicy,
  ) {}

  async search(ctx: RequestContext, q: string, limit: number): Promise<SearchHit[]> {
    const tenant = requireTenant(ctx);
    const held = ctx.permissions ?? new Set<string>();
    const allowed = held.has(PEOPLE.studentView)
      ? await this.scopes.filter(tenant, PEOPLE.studentView, 'class_section')
      : [];
    return this.db.tenant(tenant, async (c) => {
      const r = await c.query<{
        kind: SearchHit['kind'];
        id: string;
        display_name: string;
        subtitle: string;
        rank: number;
      }>('SELECT kind, id::text, display_name, subtitle, rank FROM app.search_people($1, $2)', [
        q,
        limit,
      ]);
      let hits = r.rows;
      if (!held.has(PEOPLE.employeeView)) hits = hits.filter((h) => h.kind !== 'employee');
      if (!held.has(PEOPLE.guardianView)) hits = hits.filter((h) => h.kind !== 'guardian');
      if (allowed !== null) {
        const ids = hits.filter((h) => h.kind === 'student').map((h) => h.id);
        if (ids.length > 0) {
          const visible = await c.query<{ id: string }>(
            "SELECT student_id::text AS id FROM enrolments WHERE student_id = ANY($1::bigint[]) AND status = 'active' AND academic_year_id = app.current_academic_year_id() AND class_section_id = ANY($2::bigint[])",
            [ids, allowed],
          );
          const ok = new Set(visible.rows.map((v) => v.id));
          hits = hits.filter((h) => h.kind !== 'student' || ok.has(h.id));
        }
      }
      return hits.map((h) => ({
        kind: h.kind,
        id: h.id,
        displayName: h.display_name,
        subtitle: h.subtitle,
        rank: Number(h.rank),
      }));
    });
  }
}
