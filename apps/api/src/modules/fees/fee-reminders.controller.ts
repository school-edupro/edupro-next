import { Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { FeeRemindersService } from './fee-reminders.service';
import { FEES, FeeReminderCcDto, FeeReminderDto } from './fees.dto';

/** Fee reminders to defaulters: a template per channel, a preview, a test, then the send. */
@ApiTags('fees')
@ApiBearerAuth()
@Controller('fees/reminders')
export class FeeRemindersController {
  constructor(private readonly reminders: FeeRemindersService) {}

  @Get('options')
  @ApiOperation({ summary: 'Templates by channel, staff for the copy list, the school copy list' })
  @RequirePermission(FEES.defaulterNotify)
  options(@ReqCtx() ctx: RequestContext) {
    return this.reminders.options(ctx);
  }

  @Put('cc')
  @ApiOperation({ summary: 'Keep the usual copy list of fee reminders' })
  @RequirePermission(FEES.defaulterNotify)
  saveCc(@ReqCtx() ctx: RequestContext, @Body() body: FeeReminderCcDto) {
    return this.reminders.saveCc(ctx, body.cc);
  }

  @Post('preview')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Who would be reminded, on which channel, at what cost, with which words',
  })
  @RequirePermission(FEES.defaulterNotify)
  preview(@ReqCtx() ctx: RequestContext, @Body() body: FeeReminderDto) {
    return this.reminders.preview(ctx, body);
  }

  @Post('test')
  @ApiOperation({ summary: 'Send the first reminder to myself and those on copy, as a test' })
  @RequirePermission(FEES.defaulterNotify)
  test(@ReqCtx() ctx: RequestContext, @Body() body: FeeReminderDto) {
    return this.reminders.test(ctx, body);
  }

  @Post('send')
  @ApiOperation({ summary: 'Send the reminders (or send them for approval, by the message rule)' })
  @RequirePermission(FEES.defaulterNotify)
  send(@ReqCtx() ctx: RequestContext, @Body() body: FeeReminderDto) {
    return this.reminders.send(ctx, body);
  }
}
