import { type gmail_v1 as gmailV1 } from 'googleapis';

export const getBodyData = (
  message: gmailV1.Schema$Message,
  mimeType: string = 'text/plain',
): string | undefined => {
  const parts = message.payload?.parts || [];

  // Helper function to recursively search for the desired mimeType
  const findPartByMimeType = (
    partList: gmailV1.Schema$MessagePart[] | undefined,
  ): string | undefined => {
    if (!partList) return undefined;

    for (const part of partList) {
      // Skip attachments
      if (part.filename) continue;

      if (part.mimeType === mimeType && part.body?.data) {
        return part.body.data;
      }

      // Recursively search in nested parts
      if (part.parts) {
        const result = findPartByMimeType(part.parts);
        if (result) return result;
      }
    }

    return undefined;
  };

  // Try the first part directly
  const firstPart = parts[0];
  if (firstPart) {
    // If the first part itself matches the desired mimeType and has data, return it
    if (!firstPart.filename && firstPart.mimeType === mimeType && firstPart.body?.data) {
      return firstPart.body.data;
    }

    // Otherwise search recursively through all parts
    const result = findPartByMimeType(parts);
    if (result) return result;
  }

  return undefined;
};