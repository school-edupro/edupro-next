import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { PEOPLE } from './people.permissions';
import { CorrectionRequestDto, CorrectionWithdrawDto } from './student-corrections.dto';
import { StudentCorrectionsService } from './student-corrections.service';

/** Detail corrections (docs/design/37, part 1): name, date of birth, gender and parents' names. */
@ApiTags('people')
@ApiBearerAuth()
@Controller('people/students')
export class StudentCorrectionsController {
  constructor(private readonly svc: StudentCorrectionsService) {}

  @Get('corrections/setup')
  @ApiOperation({ summary: 'The fields corrected by approval and who decides, level by level' })
  @RequirePermission(PEOPLE.studentView)
  setup(@ReqCtx() ctx: RequestContext) {
    return this.svc.setup(ctx);
  }

  @Get(':id/corrections')
  @ApiOperation({ summary: 'The correction history of a student, with old and new values' })
  @RequirePermission(PEOPLE.studentView)
  list(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.list(ctx, id);
  }

  @Post(':id/corrections')
  @ApiOperation({ summary: 'Ask for a correction; written when the approval levels approve' })
  @RequirePermission(PEOPLE.studentCorrect)
  request(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: CorrectionRequestDto,
  ) {
    return this.svc.request(ctx, id, body);
  }

  @Post(':id/corrections/:correctionId/withdraw')
  @HttpCode(200)
  @ApiOperation({ summary: 'Take back a correction still waiting (the requester)' })
  @RequirePermission(PEOPLE.studentCorrect)
  withdraw(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('correctionId') correctionId: string,
    @Body() body: CorrectionWithdrawDto,
  ) {
    return this.svc.withdraw(ctx, id, correctionId, body.reason);
  }
}
