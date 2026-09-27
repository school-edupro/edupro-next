import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, requireTenant, type RequestContext } from '../../common/http/request-context';
import {
  CreateDelegationDto,
  CreateRoleDto,
  GrantDto,
  InviteDto,
  ListAssignmentsQueryDto,
  ListMembershipsQueryDto,
  MembershipStatusDto,
  RevokeDto,
  SetScopesDto,
  UpdateAssignmentDto,
  UpdateRoleDto,
  UserSearchQueryDto,
} from './access.dto';
import { ACCESS } from './access.permissions';
import { AccessService } from './access.service';
import { AssignmentsService } from './assignments.service';
import { DelegationsService } from './delegations.service';
import { MembershipsService } from './memberships.service';
import { RolesService } from './roles.service';

@ApiTags('access')
@ApiBearerAuth()
@Controller('access')
export class AccessController {
  constructor(
    private readonly access: AccessService,
    private readonly roles: RolesService,
    private readonly assignments: AssignmentsService,
    private readonly delegations: DelegationsService,
    private readonly memberships: MembershipsService,
  ) {}

  // ---- catalogue -----------------------------------------------------------------------------------
  @Get('permissions')
  @ApiOperation({ summary: 'Permission catalogue (generated from code)' })
  @RequirePermission(ACCESS.roleView, { description: 'View roles and permissions' })
  async permissions() {
    return { data: await this.access.listPermissions() };
  }

  // ---- roles ---------------------------------------------------------------------------------------
  @Get('roles')
  @ApiOperation({ summary: 'Roles visible to this school: system templates and school roles' })
  @RequirePermission(ACCESS.roleView)
  async listRoles(@ReqCtx() ctx: RequestContext) {
    return { data: await this.roles.list(requireTenant(ctx)) };
  }

  @Get('roles/:id')
  @RequirePermission(ACCESS.roleView)
  getRole(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.roles.get(requireTenant(ctx), id);
  }

  @Post('roles')
  @ApiOperation({ summary: 'Create a school role, optionally copying a template' })
  @RequirePermission(ACCESS.roleManage, { description: 'Create and edit school roles' })
  createRole(@ReqCtx() ctx: RequestContext, @Body() body: CreateRoleDto) {
    return this.roles.create(ctx, body);
  }

  @Patch('roles/:id')
  @RequirePermission(ACCESS.roleManage)
  updateRole(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: UpdateRoleDto) {
    return this.roles.update(ctx, id, body);
  }

  @Delete('roles/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Disable a school role (refused while it has active assignments)' })
  @RequirePermission(ACCESS.roleManage)
  async disableRole(@ReqCtx() ctx: RequestContext, @Param('id') id: string): Promise<void> {
    await this.roles.disable(ctx, id);
  }

  // ---- assignments ---------------------------------------------------------------------------------
  @Get('assignments')
  @RequirePermission(ACCESS.assignmentView, { description: 'View role assignments' })
  async listAssignments(@ReqCtx() ctx: RequestContext, @Query() q: ListAssignmentsQueryDto) {
    const { rows, total } = await this.assignments.list(requireTenant(ctx), q);
    return { data: rows, page: { number: q.page, size: q.size, total } };
  }

  @Get('assignments/:id')
  @RequirePermission(ACCESS.assignmentView)
  getAssignment(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.assignments.get(requireTenant(ctx), id);
  }

  @Post('assignments')
  @ApiOperation({ summary: 'Grant a role (segregation of duties checked; MFA required)' })
  @RequirePermission(ACCESS.assignmentManage, {
    mfa: true,
    description: 'Grant and revoke roles and scopes',
  })
  grant(@ReqCtx() ctx: RequestContext, @Body() body: GrantDto) {
    return this.assignments.grant(ctx, body);
  }

  @Patch('assignments/:id')
  @RequirePermission(ACCESS.assignmentManage, { mfa: true })
  updateAssignment(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: UpdateAssignmentDto,
  ) {
    return this.assignments.update(ctx, id, body);
  }

  @Post('assignments/:id/revoke')
  @RequirePermission(ACCESS.assignmentManage, { mfa: true })
  revoke(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: RevokeDto) {
    return this.assignments.revoke(ctx, id, body.reason);
  }

  @Put('assignments/:id/scopes')
  @ApiOperation({ summary: 'Replace the data scopes of an assignment' })
  @RequirePermission(ACCESS.assignmentManage, { mfa: true })
  setScopes(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: SetScopesDto) {
    return this.assignments.setScopes(ctx, id, body);
  }

  // ---- delegations ---------------------------------------------------------------------------------
  @Get('delegations')
  @ApiOperation({ summary: 'Delegations given or received (all, for delegation managers)' })
  @RequirePermission(ACCESS.delegationCreate, { description: 'Delegate an own role' })
  async listDelegations(@ReqCtx() ctx: RequestContext) {
    return { data: await this.delegations.list(ctx) };
  }

  @Post('delegations')
  @RequirePermission(ACCESS.delegationCreate)
  createDelegation(@ReqCtx() ctx: RequestContext, @Body() body: CreateDelegationDto) {
    return this.delegations.create(ctx, body);
  }

  @Post('delegations/:id/revoke')
  @RequirePermission(ACCESS.delegationCreate)
  revokeDelegation(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.delegations.revoke(ctx, id);
  }

  // ---- memberships ---------------------------------------------------------------------------------
  @Get('memberships')
  @RequirePermission(ACCESS.assignmentView)
  async listMemberships(@ReqCtx() ctx: RequestContext, @Query() q: ListMembershipsQueryDto) {
    const { rows, total } = await this.memberships.list(requireTenant(ctx), q);
    return { data: rows, page: { number: q.page, size: q.size, total } };
  }

  @Post('memberships')
  @ApiOperation({
    summary: 'Invite a user to this school (creates the user if unknown; MFA required)',
  })
  @RequirePermission(ACCESS.membershipManage, {
    mfa: true,
    description: 'Invite users and manage memberships',
  })
  invite(@ReqCtx() ctx: RequestContext, @Body() body: InviteDto) {
    return this.memberships.invite(ctx, body);
  }

  @Patch('memberships/:id')
  @RequirePermission(ACCESS.membershipManage, { mfa: true })
  setMembershipStatus(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: MembershipStatusDto,
  ) {
    return this.memberships.setStatus(ctx, id, body.status);
  }

  @Get('users')
  @ApiOperation({ summary: 'Search users visible to this school' })
  @RequirePermission(ACCESS.userSearch, { description: 'Search users of the school' })
  async searchUsers(@ReqCtx() ctx: RequestContext, @Query() q: UserSearchQueryDto) {
    return { data: await this.memberships.searchUsers(requireTenant(ctx), q.q) };
  }
}
