import { type Email as ParsedEmail, type Header } from 'postal-mime';

import { extractEnvelopeRecipient } from 'src/modules/messaging/message-import-manager/drivers/inbound-email/utils/extract-envelope-recipient.util';

const INBOUND_DOMAIN = 'in.twenty.com';

const header = (key: string, value: string): Header => ({
  key: key.toLowerCase(),
  originalKey: key,
  value,
});

const buildParsedEmail = (
  overrides: Partial<ParsedEmail> = {},
): ParsedEmail => ({
  headers: [],
  subject: 'test',
  from: { address: 'sender@example.com', name: 'Sender' },
  to: [],
  cc: [],
  bcc: [],
  date: new Date().toISOString(),
  messageId: '<test@example.com>',
  html: '',
  text: 'test body',
  attachments: [],
  ...overrides,
});

describe('extractEnvelopeRecipient', () => {
  it('should extract recipient from Received header "for <addr>" clause', () => {
    const parsed = buildParsedEmail({
      headers: [
        header(
          'Received',
          'from mx.google.com by 10.0.0.1 for <ch_abc123@in.twenty.com>; Mon, 01 Jan 2024 00:00:00 +0000',
        ),
      ],
    });

    expect(extractEnvelopeRecipient(parsed, INBOUND_DOMAIN)).toBe(
      'ch_abc123@in.twenty.com',
    );
  });

  it('should extract from Delivered-To header', () => {
    const parsed = buildParsedEmail({
      headers: [header('Delivered-To', 'ch_def456@in.twenty.com')],
    });

    expect(extractEnvelopeRecipient(parsed, INBOUND_DOMAIN)).toBe(
      'ch_def456@in.twenty.com',
    );
  });

  it('should extract from X-Original-To header', () => {
    const parsed = buildParsedEmail({
      headers: [header('X-Original-To', 'ch_ghi789@in.twenty.com')],
    });

    expect(extractEnvelopeRecipient(parsed, INBOUND_DOMAIN)).toBe(
      'ch_ghi789@in.twenty.com',
    );
  });

  it('should fall back to To field when no delivery headers match', () => {
    const parsed = buildParsedEmail({
      to: [{ address: 'ch_tofield@in.twenty.com', name: 'Channel' }],
    });

    expect(extractEnvelopeRecipient(parsed, INBOUND_DOMAIN)).toBe(
      'ch_tofield@in.twenty.com',
    );
  });

  it('should fall back to Cc field', () => {
    const parsed = buildParsedEmail({
      to: [{ address: 'someone@other.com', name: '' }],
      cc: [{ address: 'ch_ccfield@in.twenty.com', name: '' }],
    });

    expect(extractEnvelopeRecipient(parsed, INBOUND_DOMAIN)).toBe(
      'ch_ccfield@in.twenty.com',
    );
  });

  it('should return null when no address matches the inbound domain', () => {
    const parsed = buildParsedEmail({
      to: [{ address: 'user@example.com', name: '' }],
      headers: [header('Delivered-To', 'user@other-domain.com')],
    });

    expect(extractEnvelopeRecipient(parsed, INBOUND_DOMAIN)).toBeNull();
  });

  it('should be case-insensitive on domain match', () => {
    const parsed = buildParsedEmail({
      headers: [header('Delivered-To', 'ch_upper@IN.TWENTY.COM')],
    });

    expect(extractEnvelopeRecipient(parsed, INBOUND_DOMAIN)).toBe(
      'ch_upper@in.twenty.com',
    );
  });

  it('should prefer Received header over Delivered-To', () => {
    const parsed = buildParsedEmail({
      headers: [
        header('Received', 'from mx for <ch_received@in.twenty.com>; date'),
        header('Delivered-To', 'ch_deliveredto@in.twenty.com'),
      ],
    });

    expect(extractEnvelopeRecipient(parsed, INBOUND_DOMAIN)).toBe(
      'ch_received@in.twenty.com',
    );
  });

  it('should handle empty headers gracefully', () => {
    const parsed = buildParsedEmail({
      headers: [],
      to: [],
      cc: [],
    });

    expect(extractEnvelopeRecipient(parsed, INBOUND_DOMAIN)).toBeNull();
  });
});
