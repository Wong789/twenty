import { Injectable, Logger } from '@nestjs/common';

import PostalMime, {
  type Email as ParsedEmail,
  type Address,
} from 'postal-mime';
import { MessageDirection } from 'src/modules/messaging/common/enums/message-direction.enum';
import { MessageParticipantRole } from 'twenty-shared/types';

import { type EmailAddress } from 'src/modules/messaging/message-import-manager/types/email-address';
import { type MessageWithParticipants } from 'src/modules/messaging/message-import-manager/types/message';
import { formatAddressObjectAsParticipants } from 'src/modules/messaging/message-import-manager/utils/format-address-object-as-participants.util';
import { sanitizeString } from 'src/modules/messaging/message-import-manager/utils/sanitize-string.util';
import { X_TWENTY_ORIGIN_HEADER } from 'src/modules/messaging/message-import-manager/drivers/inbound-email/constants/inbound-email.constants';

export type ParsedInboundMessage = {
  parsed: ParsedEmail;
  originWorkspaceId: string | null;
  message: MessageWithParticipants;
};

@Injectable()
export class InboundEmailParserService {
  private readonly logger = new Logger(InboundEmailParserService.name);

  async parse(
    rawMessage: Buffer,
    s3Key: string,
  ): Promise<ParsedInboundMessage> {
    const parsed = await PostalMime.parse(rawMessage);

    const originWorkspaceId = this.extractOriginWorkspaceId(parsed);
    const message = this.buildMessage(parsed, s3Key);

    return { parsed, originWorkspaceId, message };
  }

  private extractOriginWorkspaceId(parsed: ParsedEmail): string | null {
    const header = parsed.headers?.find(
      (h) => h.key?.toLowerCase() === X_TWENTY_ORIGIN_HEADER,
    );

    if (!header?.value) {
      return null;
    }

    return header.value.trim();
  }

  private buildMessage(
    parsed: ParsedEmail,
    s3Key: string,
  ): MessageWithParticipants {
    return {
      // The S3 key is the natural external id: it uniquely identifies the
      // object that produced this message and survives retries.
      externalId: `inbound-email:${s3Key}`,
      messageThreadExternalId: this.extractThreadId(parsed),
      headerMessageId: parsed.messageId?.trim() || `inbound-${s3Key}`,
      subject: sanitizeString(parsed.subject || ''),
      text: sanitizeString(parsed.text || ''),
      receivedAt: parsed.date ? new Date(parsed.date) : new Date(),
      // Forwarding channels are inbound-only — every message is incoming.
      direction: MessageDirection.INCOMING,
      attachments: (parsed.attachments || []).map((attachment) => ({
        filename: attachment.filename || 'unnamed-attachment',
      })),
      participants: this.extractParticipants(parsed),
    };
  }

  private extractThreadId(parsed: ParsedEmail): string {
    const references = parsed.references;

    if (typeof references === 'string' && references.trim()) {
      const first = references.trim().split(/\s+/)[0];

      if (first) {
        return first;
      }
    }

    if (Array.isArray(references) && references.length > 0) {
      const first = String(references[0]).trim();

      if (first) {
        return first;
      }
    }

    if (parsed.inReplyTo) {
      const inReplyTo = String(parsed.inReplyTo).trim();

      if (inReplyTo) {
        return inReplyTo;
      }
    }

    if (parsed.messageId?.trim()) {
      return parsed.messageId.trim();
    }

    return `thread-${crypto.randomUUID()}`;
  }

  private extractParticipants(parsed: ParsedEmail) {
    const addressFields = [
      { field: parsed.from, role: MessageParticipantRole.FROM },
      { field: parsed.to, role: MessageParticipantRole.TO },
      { field: parsed.cc, role: MessageParticipantRole.CC },
      { field: parsed.bcc, role: MessageParticipantRole.BCC },
    ] as const;

    return addressFields.flatMap(({ field, role }) =>
      formatAddressObjectAsParticipants(this.extractAddresses(field), role),
    );
  }

  private extractAddresses(
    address: Address | Address[] | undefined,
  ): EmailAddress[] {
    if (!address) {
      return [];
    }

    const addresses = Array.isArray(address) ? address : [address];

    const mailboxes = addresses.flatMap((addr) =>
      addr.address ? [addr] : (addr.group ?? []),
    );

    return mailboxes
      .filter((mailbox) => mailbox.address)
      .map((mailbox) => ({
        address: mailbox.address,
        name: sanitizeString(mailbox.name || ''),
      }));
  }
}
