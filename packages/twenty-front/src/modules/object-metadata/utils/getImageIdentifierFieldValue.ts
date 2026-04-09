import { isString } from '@sniptt/guards';

import { type FieldMetadataItem } from '@/object-metadata/types/FieldMetadataItem';
import { type ObjectRecord } from '@/object-record/types/ObjectRecord';
import { isDefined } from 'twenty-shared/utils';

export const getImageIdentifierFieldValue = (
  record: ObjectRecord,
  imageIdentifierFieldMetadataItem: FieldMetadataItem | undefined,
): string | null => {
  if (isDefined(imageIdentifierFieldMetadataItem?.name)) {
    const value = record[imageIdentifierFieldMetadataItem.name];
    return isString(value) ? value : null;
  }

  return null;
};
