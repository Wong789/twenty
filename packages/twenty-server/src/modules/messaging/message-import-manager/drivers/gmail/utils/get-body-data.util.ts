import { type gmail_v1 as gmailV1 } from 'googleapis';

/**
 * Recursively finds the FIRST suitable body part with the given mimeType.
 * Skips attachment parts (those with a filename property).
 * Only searches up to 2 levels deep to avoid matching deep-nested attachments.
 */
const findBodyPartByMimeType = (
  parts: gmailV1.Schema[] | undefined,
  mimeType: string,
  depth: number = 0,
): gmailV1.Schema | undefined => {
  if (!parts || depth > 2) return undefined;

  for (const part of parts) {
    // Skip attachment parts - they have a filename
    if (part.filename) continue;

    if (part.mimeType === mimeType && part.body?.data) {
      return part;
    }

    // Search nested parts (but not too deep to avoid matching attachments)
    if (part.parts && depth < 2) {
      const nested = findBodyPartByMimeType(part.parts, mimeType, depth + 1);
      if (nested) return nested;
    }
  }

  return undefined;
};

export const getBodyData = (message: gmailV1.Schema) => {
  const firstPart = message.payload?.parts?.[0];

  // Try text/plain first (from firstPart or its immediate children)
  if (firstPart?.mimeType === 'text/plain' && firstPart?.body?.data) {
    return firstPart.body.data;
  }

  // Search within firstPart's parts for text/plain (don't recurse into attachments)
  if (firstPart?.parts) {
    for (const part of firstPart.parts) {
      if (part.filename) continue; // Skip attachments
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return part.body.data;
      }
    }
  }

  // Fall back to text/html
  if (firstPart?.mimeType === 'text/html' && firstPart?.body?.data) {
    return firstPart.body.data;
  }

  // Search within firstPart's parts for text/html
  if (firstPart?.parts) {
    for (const part of firstPart.parts) {
      if (part.filename) continue; // Skip attachments
      if (part.mimeType === 'text/html' && part.body?.data) {
        return part.body.data;
      }
    }
  }

  return undefined;
};
