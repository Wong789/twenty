import { type FieldMetadataItem } from '@/object-metadata/types/FieldMetadataItem';
import { type FieldsWidgetGroupField } from '@/page-layout/widgets/fields/types/FieldsWidgetGroup';
import { type ViewField } from '@/views/types/ViewField';
import { isDefined } from 'twenty-shared/utils';

export const mapViewFieldsToFieldsWidgetGroupFields = ({
  viewFields,
  objectMetadataFields,
}: {
  viewFields: ViewField[];
  objectMetadataFields: FieldMetadataItem[];
}): FieldsWidgetGroupField[] => {
  let globalIndex = 0;

  return [...viewFields]
    .sort((a, b) => a.position - b.position)
    .map((viewField) => {
      const fieldMetadataItem = objectMetadataFields.find(
        (field) => field.id === viewField.fieldMetadataId,
      );

      if (!isDefined(fieldMetadataItem)) {
        return null;
      }

      return {
        fieldMetadataItem,
        position: viewField.position,
        isVisible: viewField.isVisible,
        globalIndex: globalIndex++,
        viewFieldId: viewField.id,
      };
    })
    .filter(isDefined);
};
