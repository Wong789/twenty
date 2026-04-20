import type { EmailsField } from '@modules/resend/shared/types/emails-field';
import type { UpdateBroadcastDto } from '@modules/resend/sync/types/update-broadcast.dto';

export type CreateBroadcastDto = UpdateBroadcastDto & {
  name: string;
  subject: string | null;
  fromAddress: EmailsField;
  replyTo: EmailsField;
  previewText: string;
  createdAt: string;
};
