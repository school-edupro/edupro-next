import { Injectable } from '@nestjs/common';
import { ScopePolicy } from '../../../common/access/scope.policy';
import { DomainError } from '../../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../../common/http/request-context';
import { PERMISSIONS } from './classes.permissions';
import type {
  ClassRow,
  ClassSectionRow,
  CreateClassDto,
  CreateClassSectionDto,
  ListClassesQueryDto,
  Page,
  UpdateClassDto,
} from './classes.dto';
import { ClassesRepository } from './classes.repository';

/**
 * Business rules for the reference module. Sets ctx.audit so AuditInterceptor records before and after
 * images. Applies scopes for section listing (Class Teacher sees own sections).
 */
@Injectable()
export class ClassesService {
  constructor(
    private readonly repo: ClassesRepository,
    private readonly scopes: ScopePolicy,
  ) {}

  async list(ctx: RequestContext, q: ListClassesQueryDto): Promise<Page<ClassRow>> {
    const { rows, total } = await this.repo.list(requireTenant(ctx), q);
    return { data: rows, page: { number: q.page, size: q.size, total } };
  }

  async get(ctx: RequestContext, id: string): Promise<ClassRow> {
    const row = await this.repo.findById(requireTenant(ctx), id);
    if (!row) throw new DomainError('not-found', 'Class not found');
    return row;
  }

  async create(ctx: RequestContext, dto: CreateClassDto): Promise<ClassRow> {
    const tenant = requireTenant(ctx);
    try {
      const created = await this.repo.insert(tenant, {
        code: dto.code,
        name: dto.name,
        displayOrder: dto.displayOrder,
      });
      ctx.audit = {
        action: 'academics.class.create',
        entityType: 'classes',
        entityId: created.id,
        after: created,
      };
      return created;
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new DomainError('conflict', `Class code "${dto.code}" already exists`);
      }
      throw error;
    }
  }

  async update(ctx: RequestContext, id: string, dto: UpdateClassDto): Promise<ClassRow> {
    const tenant = requireTenant(ctx);
    try {
      const result = await this.repo.update(tenant, id, dto);
      if (!result) throw new DomainError('not-found', 'Class not found');
      ctx.audit = {
        action: 'academics.class.edit',
        entityType: 'classes',
        entityId: id,
        before: result.before,
        after: result.after,
      };
      return result.after;
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new DomainError('conflict', `Class code "${dto.code}" already exists`);
      }
      throw error;
    }
  }

  async remove(ctx: RequestContext, id: string): Promise<void> {
    const tenant = requireTenant(ctx);
    const before = await this.repo.softDelete(tenant, id);
    if (!before) throw new DomainError('not-found', 'Class not found');
    ctx.audit = { action: 'academics.class.delete', entityType: 'classes', entityId: id, before };
  }

  async listSections(ctx: RequestContext, classId: string): Promise<ClassSectionRow[]> {
    const tenant = requireTenant(ctx);
    if (!tenant.academicYearId)
      throw new DomainError('year.not_selected', 'No academic year is active or selected', {
        status: 409,
      });
    await this.get(ctx, classId);
    const allowed = await this.scopes.filter(tenant, PERMISSIONS.sectionView, 'class_section');
    return this.repo.listSections(tenant, classId, allowed);
  }

  async createSection(
    ctx: RequestContext,
    classId: string,
    dto: CreateClassSectionDto,
  ): Promise<ClassSectionRow> {
    const tenant = requireTenant(ctx);
    if (!tenant.academicYearId)
      throw new DomainError('year.not_selected', 'No academic year is active or selected', {
        status: 409,
      });
    await this.get(ctx, classId);
    try {
      const created = await this.repo.insertSection(tenant, classId, dto);
      ctx.audit = {
        action: 'academics.class_section.create',
        entityType: 'class_sections',
        entityId: created.id,
        after: created,
      };
      return created;
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new DomainError(
          'conflict',
          `Section "${dto.name}" already exists for this class and year`,
        );
      }
      throw error;
    }
  }
}
