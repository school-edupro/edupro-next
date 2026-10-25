import { randomUUID } from 'node:crypto';

/**
 * What an admission message is, kept in its variables (docs/design/44, part 1): the family's Messages
 * puts the office's own words (answers, enquiry replies, invitations) under "From the school" and the
 * rest under "Automatic updates", links each to its registration or question, and shows the email and
 * SMS / WhatsApp copies of one message as one item (`_nid`). Keys start with "_": no template uses them.
 */
export type MessageOrigin =
  'status' | 'answer' | 'enquiry_reply' | 'enquiry_invite' | 'enquiry_ack';

export const messageTag = (
  origin: MessageOrigin,
  ids: { applicationId?: string | null; queryId?: string | null } = {},
): Record<string, string> => ({
  _origin: origin,
  _nid: randomUUID(),
  ...(ids.applicationId ? { _app: String(ids.applicationId) } : {}),
  ...(ids.queryId ? { _query: String(ids.queryId) } : {}),
});
