import { type Email as ParsedEmail } from 'postal-mime';

// SES inbound action writes the raw MIME to S3 without preserving the SMTP
// envelope ("RCPT TO"). We recover the envelope recipient by walking the
// headers in priority order: delivery headers first (most reliable), then
// To/Cc as a fallback. The first address whose domain matches our inbound
// domain wins, which is what we use to look up the forwarding channel.

type HeaderLike =
  | string
  | string[]
  | { key?: string; value?: string }[]
  | undefined;

const EMAIL_REGEX = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g;

const extractEmailsFromText = (text: string): string[] => {
  const matches = text.match(EMAIL_REGEX);

  return matches ? matches.map((email) => email.toLowerCase()) : [];
};

const headerValues = (
  headers: ParsedEmail['headers'] | undefined,
  name: string,
): string[] => {
  if (!headers) {
    return [];
  }

  const target = name.toLowerCase();

  return headers
    .filter((header) => header.key?.toLowerCase() === target)
    .map((header) => header.value ?? '');
};

const addressesFromParsedField = (
  field: ParsedEmail['to'] | ParsedEmail['cc'],
): string[] => {
  if (!field) {
    return [];
  }

  const list = Array.isArray(field) ? field : [field];

  return list
    .flatMap((entry) =>
      entry.address
        ? [entry.address]
        : (entry.group ?? []).map((g) => g.address ?? ''),
    )
    .filter((address) => address.length > 0)
    .map((address) => address.toLowerCase());
};

export const extractEnvelopeRecipient = (
  parsed: ParsedEmail,
  inboundDomain: string,
  rawHeaders?: HeaderLike,
): string | null => {
  const domain = inboundDomain.toLowerCase();
  const isMatch = (address: string): boolean => address.endsWith(`@${domain}`);

  // SES adds "X-Original-To" and "Delivered-To" on many flows; Received
  // headers include "for <addr>" which is the closest thing to the envelope
  // recipient that survives MIME parsing.
  const receivedValues = headerValues(parsed.headers, 'received');

  for (const received of receivedValues) {
    const forMatch = received.match(/\bfor\s+<?([^\s>;]+)>?/i);

    if (forMatch) {
      const candidate = forMatch[1].toLowerCase();

      if (isMatch(candidate)) {
        return candidate;
      }
    }
  }

  const deliveryHeaders = [
    ...headerValues(parsed.headers, 'delivered-to'),
    ...headerValues(parsed.headers, 'x-original-to'),
    ...headerValues(parsed.headers, 'x-forwarded-to'),
    ...headerValues(parsed.headers, 'x-envelope-to'),
  ];

  for (const raw of deliveryHeaders) {
    for (const candidate of extractEmailsFromText(raw)) {
      if (isMatch(candidate)) {
        return candidate;
      }
    }
  }

  const toCandidates = [
    ...addressesFromParsedField(parsed.to),
    ...addressesFromParsedField(parsed.cc),
  ];

  for (const candidate of toCandidates) {
    if (isMatch(candidate)) {
      return candidate;
    }
  }

  // rawHeaders is a last-ditch escape hatch for callers that have the raw
  // message available and want to scan any arbitrary header line.
  if (rawHeaders) {
    const flat = Array.isArray(rawHeaders)
      ? rawHeaders
          .map((h) => (typeof h === 'string' ? h : (h?.value ?? '')))
          .join('\n')
      : rawHeaders;

    if (typeof flat === 'string') {
      for (const candidate of extractEmailsFromText(flat)) {
        if (isMatch(candidate)) {
          return candidate;
        }
      }
    }
  }

  return null;
};
