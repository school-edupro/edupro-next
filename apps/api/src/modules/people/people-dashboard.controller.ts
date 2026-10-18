import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { PeopleDashboardService } from './people-dashboard.service';
import { PEOPLE } from './people.permissions';

/** The student and employee dashboards (docs/design/33-people-dashboards.md). */
@ApiTags('people')
@ApiBearerAuth()
@Controller('people/dashboard')
export class PeopleDashboardController {
  constructor(private readonly svc: PeopleDashboardService) {}

  @Get('students')
  @ApiOperation({ summary: 'Students: strength, movement, today, record health' })
  @RequirePermission(PEOPLE.studentView)
  students(@ReqCtx() ctx: RequestContext, @Query('class') classId?: string) {
    return this.svc.students(ctx, classId && /^\d{1,18}$/.test(classId) ? classId : undefined);
  }

  @Get('staff')
  @ApiOperation({ summary: 'Employees: strength, movement, today, record health and HR' })
  @RequirePermission(PEOPLE.employeeView)
  staff(@ReqCtx() ctx: RequestContext, @Query('department') department?: string) {
    return this.svc.staff(ctx, department?.trim() ? department.trim().slice(0, 80) : undefined);
  }
}
