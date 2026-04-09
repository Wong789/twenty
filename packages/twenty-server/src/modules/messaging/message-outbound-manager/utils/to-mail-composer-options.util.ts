import { X_TWENTY_ORIGIN_HEADER } from 'src/modules/messaging/message-import-manager/drivers/inbound-email/constants/inbound-email.constants';
import { type SendMessageInput } from 'src/modules/messaging/message-outbound-manager/types/send-message-input.type';

export const toMailComposerOptions = (
  from: string,
  sendMessageInput: SendMessageInput,
) => {
  // Stamp outbound mail with the originating workspace id so the inbound
  // forwarding pipeline can drop loopbacks when a reply hits the group
  // address that the forwarding channel is a member of.
  const headers: Record<string, string> = {};

  if (sendMessageInput.originWorkspaceId) {
    headers[X_TWENTY_ORIGIN_HEADER] = sendMessageInput.originWorkspaceId;
  }

  return {
    from,
    to: sendMessageInput.to,
    cc: sendMessageInput.cc,
    bcc: sendMessageInput.bcc,
    subject: sendMessageInput.subject,
    text: sendMessageInput.body,
    html: sendMessageInput.html,
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
    ...(sendMessageInput.attachments && sendMessageInput.attachments.length > 0
      ? {
          attachments: sendMessageInput.attachments.map((attachment) => ({
            filename: attachment.filename,
            content: attachment.content,
            contentType: attachment.contentType,
          })),
        }
      : {}),
    ...(sendMessageInput.inReplyTo
      ? {
          inReplyTo: sendMessageInput.inReplyTo,
          references: sendMessageInput.inReplyTo,
        }
      : {}),
  };
};
