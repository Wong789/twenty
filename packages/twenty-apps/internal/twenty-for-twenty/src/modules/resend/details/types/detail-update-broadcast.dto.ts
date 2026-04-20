import type { EmailsField } from '@modules/resend/shared/types/emails-field';

export type DetailUpdateBroadcastDto = {
  subject: string;
  fromAddress: EmailsField;
  replyTo: EmailsField;
  previewText: string;
};
