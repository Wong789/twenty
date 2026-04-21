import { type gmail_v1 as gmailV1 } from 'googleapis';

/**
 * Recursively finds a part with the given mimeType in the parts array.
 */
const findPartByMimeType = (
  parts: gmailV1.Schema[] | undefined,
  mimeType: string,
): gmailV1.Schema | undefined => {
  if (!parts) return undefined;

  for (const part of parts) {
    if (part.mimeType === mimeType && part.body?.data) {
      return part;
    }
    // Search nested parts
    const nested = findPartByMimeType(part.parts, mimeType);
    if (nested) return nested;
  }

  return undefined;
};

export const getBodyData = (message: gmailV1.Schema) => {
  // First, try to find text/plain
  const firstPart = message.payload?.parts?.[0];
  
  if (firstPart?.mimeType === 'text/plain' && firstPart?.body?.data) {
    return firstPart.body.data;
  }

  const textPlainPart = findPartByMimeType(message.payload?.parts, 'text/plain');
  if (textPlainPart?.body?.data) {
    return textPlainPart.body.data;
  }

  // Fall back to text/html if no text/plain found
  if (firstPart?.mimeType === 'text/html' && firstPart?.body?.data) {
    return firstPart.body.data;
  }

  const textHtmlPart = findPartByMimeType(message.payload?.parts, 'text/html');
  if (textHtmlPart?.body?.data) {
    return textHtmlPart.body.data;
  }

  return undefined;
};
