import { DomainError } from '../../../common/errors/domain-error';
import type { RequestContext } from '../../../common/http/request-context';
import { ClassesService } from './classes.service';

const tenant = {
  schoolId: '1',
  userId: '10',
  allowedSchoolIds: ['1'],
  academicYearId: '100',
  requestId: 'r1',
};
const ctx = (): RequestContext => ({
  requestId: 'r1',
  user: { id: '10', sub: 'dev-a', displayName: 'A', memberships: [], mfa: true, dev: true },
  tenant,
});

describe('ClassesService', () => {
  const repo = {
    list: jest.fn(),
    findById: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
    listSections: jest.fn(),
    insertSection: jest.fn(),
  };
  const scopes = { filter: jest.fn(), assert: jest.fn() };
  const service = new ClassesService(repo as never, scopes as never);

  beforeEach(() => jest.resetAllMocks());

  it('creates a class and records an audit snapshot', async () => {
    const created = {
      id: '5',
      code: 'VI',
      name: 'Class VI',
      displayOrder: 6,
      status: 'active',
      createdAt: 'x',
      updatedAt: 'x',
    };
    repo.insert.mockResolvedValue(created);
    const c = ctx();
    await expect(
      service.create(c, { code: 'VI', name: 'Class VI', displayOrder: 6 }),
    ).resolves.toEqual(created);
    expect(c.audit).toMatchObject({
      action: 'academics.class.create',
      entityType: 'classes',
      entityId: '5',
    });
  });

  it('maps a unique violation to a conflict problem', async () => {
    repo.insert.mockRejectedValue(Object.assign(new Error('dup'), { code: '23505' }));
    await expect(
      service.create(ctx(), { code: 'VI', name: 'Class VI', displayOrder: 0 }),
    ).rejects.toMatchObject({
      type: 'conflict',
      status: 409,
    });
  });

  it('returns not-found for unknown ids', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(service.get(ctx(), '999')).rejects.toBeInstanceOf(DomainError);
  });

  it('applies class_section scope when listing sections', async () => {
    repo.findById.mockResolvedValue({ id: '5' });
    scopes.filter.mockResolvedValue(['7', '8']);
    repo.listSections.mockResolvedValue([]);
    await service.listSections(ctx(), '5');
    expect(repo.listSections).toHaveBeenCalledWith(tenant, '5', ['7', '8']);
  });

  it('refuses section operations without a working year', async () => {
    const c = ctx();
    c.tenant = { ...tenant, academicYearId: null };
    await expect(service.listSections(c, '5')).rejects.toMatchObject({ type: 'year.not_selected' });
  });
});
