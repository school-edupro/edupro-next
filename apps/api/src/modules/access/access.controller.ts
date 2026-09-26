import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, requireTenant, type RequestContext } from '../../common/http/request-context';
import { AccessService } from './access.service';

@ApiTags('access')
@ApiBearerAuth()
@Controller('access')
export class AccessController {
  constructor(private readonly access: AccessService) {}

  @Get('permissions')
  @ApiOperation({ summary: 'Permission catalogue (generated from code)' })
  @RequirePermission('access.role.view', { description: 'View roles and permissions' })
  async permissions() {
    return { data: await this.access.listPermissions() };
  }

  @Get('roles')
  @ApiOperation({ summary: 'Roles visible to this school: system templates and school roles' })
  @RequirePermission('access.role.view')
  async roles(@ReqCtx() ctx: RequestContext) {
    return { data: await this.access.listRoles(requireTenant(ctx)) };
  }
}
