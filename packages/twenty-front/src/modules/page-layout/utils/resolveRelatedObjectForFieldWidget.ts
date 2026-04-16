import { type EnrichedObjectMetadataItem } from '@/object-metadata/types/EnrichedObjectMetadataItem';
import { type FieldMetadataItem } from '@/object-metadata/types/FieldMetadataItem';
import { isDefined } from 'twenty-shared/utils';

export const resolveRelatedObjectForFieldWidget = ({
  objectMetadataItems,
  parentObjectMetadataId,
  fieldMetadataId,
}: {
  objectMetadataItems: EnrichedObjectMetadataItem[];
  parentObjectMetadataId: string;
  fieldMetadataId: string;
}):
  | { field: FieldMetadataItem; relatedObject: EnrichedObjectMetadataItem }
  | undefined => {
  const parentObject = objectMetadataItems.find(
    (item) => item.id === parentObjectMetadataId,
  );

  if (!isDefined(parentObject)) {
    return undefined;
  }

  const field = parentObject.fields.find(
    (fieldItem) => fieldItem.id === fieldMetadataId,
  );
  const relatedObjectId = field?.relation?.targetObjectMetadata.id;

  if (!isDefined(field) || !isDefined(relatedObjectId)) {
    return undefined;
  }

  const relatedObject = objectMetadataItems.find(
    (item) => item.id === relatedObjectId,
  );

  if (!isDefined(relatedObject)) {
    return undefined;
  }

  return { field, relatedObject };
};
