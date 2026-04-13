import { useObjectMetadataItem } from '@/object-metadata/hooks/useObjectMetadataItem';
import { type FieldsWidgetDisplayMode } from '@/page-layout/widgets/fields/types/FieldsWidgetDisplayMode';
import {
  type FieldsWidgetGroup,
  type FieldsWidgetGroupField,
} from '@/page-layout/widgets/fields/types/FieldsWidgetGroup';
import { mapViewFieldsToFieldsWidgetGroupFields } from '@/page-layout/widgets/fields/utils/mapViewFieldsToFieldsWidgetGroupFields';
import { useViewById } from '@/views/hooks/useViewById';
import { useMemo } from 'react';
import { isDefined, isNonEmptyArray } from 'twenty-shared/utils';

type UseFieldsWidgetGroupsParams = {
  viewId: string | null;
  objectNameSingular: string;
};

export const useFieldsWidgetGroups = ({
  viewId,
  objectNameSingular,
}: UseFieldsWidgetGroupsParams) => {
  const { view } = useViewById(viewId);
  const { objectMetadataItem } = useObjectMetadataItem({
    objectNameSingular,
  });

  const { groups, displayMode } = useMemo<{
    groups: FieldsWidgetGroup[];
    displayMode: FieldsWidgetDisplayMode;
  }>(() => {
    if (!isDefined(objectMetadataItem)) {
      return { groups: [], displayMode: 'inline' };
    }

    if (isDefined(view) && isNonEmptyArray(view.viewFieldGroups)) {
      const sortedGroups = view.viewFieldGroups.toSorted(
        (a, b) => a.position - b.position,
      );

      let globalIndex = 0;

      const groups = sortedGroups
        .filter((group) => group.isVisible)
        .map((group) => {
          const groupFields = [...(group.viewFields ?? [])].sort(
            (a, b) => a.position - b.position,
          );

          const fields: FieldsWidgetGroupField[] = groupFields
            .filter((field) => field.isVisible)
            .map((viewField) => {
              const fieldMetadataItem = objectMetadataItem.fields.find(
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
              };
            })
            .filter(isDefined);

          return {
            id: group.id,
            name: group.name,
            position: group.position,
            isVisible: group.isVisible,
            fields,
          };
        })
        .filter((group) => group.fields.length > 0);

      return { groups, displayMode: 'grouped' };
    }

    if (isDefined(view) && view.viewFields.length > 0) {
      const allFields = mapViewFieldsToFieldsWidgetGroupFields({
        viewFields: view.viewFields,
        objectMetadataFields: objectMetadataItem.fields,
      });

      const visibleFields = allFields.filter((field) => field.isVisible);

      if (visibleFields.length === 0) {
        return { groups: [], displayMode: 'inline' };
      }

      return {
        groups: [
          {
            id: `${viewId}-ungrouped`,
            name: '',
            position: 0,
            isVisible: true,
            fields: visibleFields,
          },
        ],
        displayMode: 'inline',
      };
    }

    return { groups: [], displayMode: 'inline' };
  }, [objectMetadataItem, view, viewId]);

  return {
    groups,
    displayMode,
    isFromView:
      isDefined(view) &&
      (isNonEmptyArray(view.viewFieldGroups) || view.viewFields.length > 0),
  };
};
