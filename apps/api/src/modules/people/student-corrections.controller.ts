import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { PEOPLE } from './people.permissions';
import { ClassCorrectionDto } from './class-corrections.dto';
import { ClassCorrectionsService } from './class-corrections.service';
import { CorrectionRequestDto, CorrectionWithdrawDto } from './student-corrections.dto';
import { StudentCorrectionsService } from './student-corrections.service';

/** Corrections (docs/design/37): details (part 1) and class (part 2), decided by the approval levels. */
@ApiTags('people')
@ApiBearerAuth()
@Controller('people/students')
export class StudentCorrectionsController {
  constructor(
    private readonly svc: StudentCorrectionsService,
    private readonly classes: ClassCorrectionsService,
  ) {}

  @Get('corrections/setup')
  @ApiOperation({ summary: 'The fields corrected by approval and who decides, level by level' })
  @RequirePermission(PEOPLE.studentView)
  setup(@ReqCtx() ctx: RequestContext) {
    return this.svc.setup(ctx);
  }

  @Get('class-corrections/setup')
  @ApiOperation({ summary: 'Who decides a class correction, and the sections of the working year' })
  @RequirePermission(PEOPLE.studentView)
  classSetup(@ReqCtx() ctx: RequestContext) {
    return this.classes.setup(ctx);
  }

  @Get(':id/class-corrections')
  @ApiOperation({ summary: 'The class corrections of a student, with what each did to the fees' })
  @RequirePermission(PEOPLE.studentView)
  classList(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.classes.list(ctx, id);
  }

  @Post(':id/class-corrections/preview')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'What a class correction would do: section, roll number, fee lines, advance (nothing saved)',
  })
  @RequirePermission(PEOPLE.classCorrect)
  classPreview(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: ClassCorrectionDto,
  ) {
    return this.classes.preview(ctx, id, body);
  }

  @Post(':id/class-corrections')
  @ApiOperation({ summary: 'Ask for a class correction; done when the approval levels approve' })
  @RequirePermission(PEOPLE.classCorrect)
  classRequest(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: ClassCorrectionDto,
  ) {
    return this.classes.request(ctx, id, body);
  }

  @Post(':id/class-corrections/:correctionId/withdraw')
  @HttpCode(200)
  @ApiOperation({ summary: 'Take back a class correction still waiting (the requester)' })
  @RequirePermission(PEOPLE.classCorrect)
  classWithdraw(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('correctionId') correctionId: string,
    @Body() body: CorrectionWithdrawDto,
  ) {
    return this.classes.withdraw(ctx, id, correctionId, body.reason);
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
