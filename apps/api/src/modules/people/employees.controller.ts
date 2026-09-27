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
import { EmployeesService } from './employees.service';
import {
  AddDocumentDto,
  CreateEmployeeDto,
  ListEmployeesQueryDto,
  UpdateEmployeeDto,
  UpsertPostingDto,
} from './people.dto';
import { PEOPLE } from './people.permissions';

@ApiTags('people')
@ApiBearerAuth()
@Controller('people/employees')
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @Get()
  @RequirePermission(PEOPLE.employeeView, { description: 'View employees' })
  async list(@ReqCtx() ctx: RequestContext, @Query() q: ListEmployeesQueryDto) {
    const { rows, total } = await this.employees.list(requireTenant(ctx), q);
    return { data: rows, page: { number: q.page, size: q.size, total } };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Employee 360: record, postings, documents, direct reports' })
  @RequirePermission(PEOPLE.employeeView)
  get(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.employees.get(ctx, id);
  }

  @Post()
  @RequirePermission(PEOPLE.employeeCreate, { description: 'Create employees' })
  create(@ReqCtx() ctx: RequestContext, @Body() body: CreateEmployeeDto) {
    return this.employees.create(ctx, body);
  }

  @Patch(':id')
  @RequirePermission(PEOPLE.employeeEdit, {
    description: 'Edit employee records, postings and documents',
  })
  update(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: UpdateEmployeeDto) {
    return this.employees.update(ctx, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission(PEOPLE.employeeDelete, { mfa: true, description: 'Remove an employee record' })
  async remove(@ReqCtx() ctx: RequestContext, @Param('id') id: string): Promise<void> {
    await this.employees.remove(ctx, id);
  }

  @Put(':id/postings')
  @ApiOperation({
    summary: 'Set the posting for a year (department, designation, campus, reporting line)',
  })
  @RequirePermission(PEOPLE.employeeEdit)
  posting(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: UpsertPostingDto) {
    return this.employees.upsertPosting(ctx, id, body);
  }

  @Post(':id/documents')
  @RequirePermission(PEOPLE.employeeEdit)
  addDocument(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: AddDocumentDto,
  ) {
    return this.employees.addDocument(ctx, id, body);
  }

  @Post(':id/id-card')
  @RequirePermission(PEOPLE.employeeView)
  idCard(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.employees.requestIdCard(ctx, id);
  }
}
