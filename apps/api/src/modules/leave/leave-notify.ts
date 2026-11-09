import type { Logger } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import type { RequestContext } from '../../common/http/request-context';
import type { SendMessageDto } from '../comms/comms.dto';
import type { MessagesService } from '../comms/messages.service';

/**
 * A leave or attendance message to these people on the school's channels (Leave & attendance settings):
 * e-mail, the app and WhatsApp (docs/design/85). WhatsApp goes only once the school has put the name Meta
 * approved on the message's WhatsApp template; a message that cannot go never stops the leave.
 */
export async function notifyLeave(
  messages: MessagesService,
  log: Logger,
  c: PoolClient,
  ctx: RequestContext,
  code: string,
  userIds: Array<string | null | undefined>,
  vars: Record<string, string | number>,
) {
  const s = (
    await c.query<{ send_email: boolean; send_app: boolean; send_whatsapp: boolean }>(
      `SELECT send_email, send_app, send_whatsapp FROM staff_leave_settings`,
    )
  ).rows[0];
  if (!s) return;
  const channels = [
    ...(s.send_email ? ['email'] : []),
    ...(s.send_app ? ['push'] : []),
    ...(s.send_whatsapp ? ['whatsapp'] : []),
  ];
  // WhatsApp only when this message's template has the name Meta approved (as every template message:
  // without it the provider refuses the message, so it is not queued at all)
  if (channels.includes('whatsapp')) {
    const ready = await c.query(
      `SELECT 1 FROM comms_templates WHERE code = $1 AND channel = 'whatsapp' AND status = 'active'
          AND deleted_at IS NULL AND COALESCE(btrim(wa_template_name), '') <> ''`,
      [code],
    );
    if (!ready.rowCount) channels.splice(channels.indexOf('whatsapp'), 1);
  }
  for (const user of [...new Set(userIds.filter((u): u is string => !!u))])
    for (const channel of channels) {
      await c.query('SAVEPOINT leave_msg');
      try {
        await messages.sendWith(c, ctx, {
          templateCode: code,
          channel,
          recipientUserId: user,
          variables: vars,
        } as SendMessageDto);
        await c.query('RELEASE SAVEPOINT leave_msg');
      } catch (e) {
        await c.query('ROLLBACK TO SAVEPOINT leave_msg');
        log.debug({ code, channel, error: (e as Error).message }, 'leave message not sent');
      }
    }
}
