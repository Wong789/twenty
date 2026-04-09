import { isNonEmptyString } from '@sniptt/guards';

import { type ObjectRecord } from '@/object-record/types/ObjectRecord';

export const getPrimaryEmailFromRecord = (
  record: ObjectRecord,
): string | null => {
  const emails = record.emails;

  if (emails === null || typeof emails !== 'object') {
    return null;
  }

  const primaryEmail = (emails as { primaryEmail?: unknown }).primaryEmail;

  return isNonEmptyString(primaryEmail) ? primaryEmail : null;
};
