import { metadataStoreState } from '@/metadata-store/states/metadataStoreState';
import { type FlatView } from '@/metadata-store/types/FlatView';
import { type FlatViewField } from '@/metadata-store/types/FlatViewField';
import { objectMetadataItemsSelector } from '@/object-metadata/states/objectMetadataItemsSelector';
import { fieldsWidgetEditorModeDraftComponentState } from '@/page-layout/states/fieldsWidgetEditorModeDraftComponentState';
import { fieldsWidgetGroupsDraftComponentState } from '@/page-layout/states/fieldsWidgetGroupsDraftComponentState';
import { fieldsWidgetUngroupedFieldsDraftComponentState } from '@/page-layout/states/fieldsWidgetUngroupedFieldsDraftComponentState';
import { hasInitializedFieldsWidgetGroupsDraftComponentState } from '@/page-layout/states/hasInitializedFieldsWidgetGroupsDraftComponentState';
import { resolveRelatedObjectForFieldWidget } from '@/page-layout/utils/resolveRelatedObjectForFieldWidget';
import { buildDefaultViewFieldInputs } from '@/page-layout/widgets/field/utils/buildDefaultViewFieldInputs';
import { useStore } from 'jotai';
import { useCallback } from 'react';
import { isDefined } from 'twenty-shared/utils';
import {
  ViewOpenRecordIn,
  ViewType,
  ViewVisibility,
} from '~/generated-metadata/graphql';

export const useSeedDraftViewForFieldWidgetTable = () => {
  const store = useStore();

  const seedDraftViewForFieldWidgetTable = useCallback(
    ({
      viewId,
      fieldMetadataId,
      parentObjectMetadataId,
      pageLayoutId,
      widgetId,
    }: {
      viewId: string;
      fieldMetadataId: string;
      parentObjectMetadataId: string;
      pageLayoutId: string;
      widgetId: string;
    }) => {
      const objectMetadataItems = store.get(objectMetadataItemsSelector.atom);

      const resolved = resolveRelatedObjectForFieldWidget({
        objectMetadataItems,
        parentObjectMetadataId,
        fieldMetadataId,
      });

      if (!isDefined(resolved)) {
        return;
      }

      const { relatedObject } = resolved;

      const viewsEntry = store.get(metadataStoreState.atomFamily('views'));
      const viewsCurrent = viewsEntry.current as FlatView[];

      if (viewsCurrent.some((view) => view.id === viewId)) {
        return;
      }

      const syntheticView: FlatView = {
        id: viewId,
        name: `${relatedObject.labelPlural} Table`,
        icon: relatedObject.icon ?? 'IconTable',
        objectMetadataId: relatedObject.id,
        type: ViewType.TABLE_WIDGET,
        isCompact: false,
        shouldHideEmptyGroups: false,
        position: 0,
        openRecordIn: ViewOpenRecordIn.SIDE_PANEL,
        visibility: ViewVisibility.UNLISTED,
        key: null,
      };

      store.set(metadataStoreState.atomFamily('views'), {
        ...viewsEntry,
        current: [...viewsCurrent, syntheticView],
      });

      const syntheticViewFields: FlatViewField[] = buildDefaultViewFieldInputs({
        relatedObject,
        viewId,
      }).map((input) => ({
        ...input,
        isActive: true,
      }));

      const viewFieldsEntry = store.get(
        metadataStoreState.atomFamily('viewFields'),
      );
      const viewFieldsCurrent = viewFieldsEntry.current as FlatViewField[];

      store.set(metadataStoreState.atomFamily('viewFields'), {
        ...viewFieldsEntry,
        current: [...viewFieldsCurrent, ...syntheticViewFields],
      });

      const ungroupedDraftFields = syntheticViewFields
        .map((viewField, index) => {
          const fieldMetadataItem = relatedObject.fields.find(
            (field) => field.id === viewField.fieldMetadataId,
          );

          if (!isDefined(fieldMetadataItem)) {
            return undefined;
          }

          return {
            fieldMetadataItem,
            position: viewField.position,
            isVisible: viewField.isVisible,
            globalIndex: index,
            viewFieldId: viewField.id,
          };
        })
        .filter(isDefined);

      store.set(
        fieldsWidgetUngroupedFieldsDraftComponentState.atomFamily({
          instanceId: pageLayoutId,
        }),
        (prev) => ({
          ...prev,
          [widgetId]: ungroupedDraftFields,
        }),
      );

      store.set(
        fieldsWidgetEditorModeDraftComponentState.atomFamily({
          instanceId: pageLayoutId,
        }),
        (prev) => ({
          ...prev,
          [widgetId]: 'ungrouped',
        }),
      );

      store.set(
        fieldsWidgetGroupsDraftComponentState.atomFamily({
          instanceId: pageLayoutId,
        }),
        (prev) => ({
          ...prev,
          [widgetId]: [],
        }),
      );

      store.set(
        hasInitializedFieldsWidgetGroupsDraftComponentState.atomFamily({
          instanceId: pageLayoutId,
        }),
        (prev) => ({
          ...prev,
          [widgetId]: true,
        }),
      );
    },
    [store],
  );

  return { seedDraftViewForFieldWidgetTable };
};
