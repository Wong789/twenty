import type { EmailsField } from '@modules/resend/shared/types/emails-field';

export type DetailUpdateTemplateDto = {
  fromAddress: EmailsField;
  subject: string;
  replyTo: EmailsField;
  htmlBody: string;
  textBody: string;
};
