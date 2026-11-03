import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthenticatedOnly } from '../../common/auth/decorators';
import { DomainError } from '../../common/errors/domain-error';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import {
  STUDENT_REGISTERS,
  StudentRegisterQueryDto,
  type StudentRegisterType,
} from './student-registers.dto';
import { StudentRegistersService } from './student-registers.service';

/**
 * The Remark, Attendance and Height & Weight registers (docs/design/69, part 1). The service checks the
 * rights: exams.marks.view (and exams.health.view for heights and weights); a manager of mark registers
 * sees every section, anyone else the sections they teach.
 */
@ApiTags('exams')
@ApiBearerAuth()
@Controller('exams/registers')
export class StudentRegistersController {
  constructor(private readonly svc: StudentRegistersService) {}

  @Get(':type')
  @AuthenticatedOnly()
  @ApiOperation({
    summary:
      'A Remark, Attendance or Height & Weight register of a class: a section or all, some exams',
    description: 'JSON for the screen, or a PDF / Excel at once (format=pdf|xlsx)',
  })
  run(
    @ReqCtx() ctx: RequestContext,
    @Param('type') type: string,
    @Query() q: StudentRegisterQueryDto,
  ) {
    if (!(STUDENT_REGISTERS as readonly string[]).includes(type))
      throw new DomainError('not-found', 'Unknown register', { status: 404 });
    return this.svc.run(ctx, type as StudentRegisterType, q);
  }
}
