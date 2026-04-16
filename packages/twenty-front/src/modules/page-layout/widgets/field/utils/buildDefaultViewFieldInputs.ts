import { type EnrichedObjectMetadataItem } from '@/object-metadata/types/EnrichedObjectMetadataItem';
import {
  DEFAULT_VIEW_FIELD_SIZE,
  INITIAL_VISIBLE_FIELDS_COUNT_IN_WIDGET,
} from '@/page-layout/widgets/field/constants/fieldWidgetTableDefaults';
import { filterFieldsForRecordTableViewCreation } from '@/page-layout/widgets/record-table/utils/filterFieldsForRecordTableViewCreation';
import { sortFieldsByRelevanceForRecordTableWidget } from '@/page-layout/widgets/record-table/utils/sortFieldsByRelevanceForRecordTableWidget';
import { v4 } from 'uuid';

export const buildDefaultViewFieldInputs = ({
  relatedObject,
  viewId,
}: {
  relatedObject: EnrichedObjectMetadataItem;
  viewId: string;
}) => {
  const eligibleFields = relatedObject.fields.filter(
    filterFieldsForRecordTableViewCreation,
  );

  const sortedFields = eligibleFields.toSorted(
    sortFieldsByRelevanceForRecordTableWidget(
      relatedObject.labelIdentifierFieldMetadataId,
    ),
  );

  return sortedFields.map((field, index) => ({
    id: v4(),
    viewId,
    fieldMetadataId: field.id,
    position: index,
    size: DEFAULT_VIEW_FIELD_SIZE,
    isVisible: index < INITIAL_VISIBLE_FIELDS_COUNT_IN_WIDGET,
  }));
};
