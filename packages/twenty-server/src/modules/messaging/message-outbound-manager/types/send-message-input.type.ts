type EmailAddress = string | string[];

export type SendMessageInput = {
  body: string;
  subject: string;
  to: EmailAddress;
  cc?: EmailAddress;
  bcc?: EmailAddress;
  html: string;
  attachments?: {
    filename: string;
    content: Buffer;
    contentType: string;
  }[];
  inReplyTo?: string;
  threadExternalId?: string;
  // When set, an X-Twenty-Origin header is stamped on the outbound message.
  // Used by the inbound-email forwarding pipeline to drop group echoes.
  originWorkspaceId?: string;
};
