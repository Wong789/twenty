import { objectMetadataItemsSelector } from '@/object-metadata/states/objectMetadataItemsSelector';
import { fieldsWidgetUngroupedFieldsDraftComponentState } from '@/page-layout/states/fieldsWidgetUngroupedFieldsDraftComponentState';
import { pageLayoutDraftComponentState } from '@/page-layout/states/pageLayoutDraftComponentState';
import { pageLayoutPersistedComponentState } from '@/page-layout/states/pageLayoutPersistedComponentState';
import { type FieldConfiguration } from '@/page-layout/types/FieldConfiguration';
import { type PageLayoutWidget } from '@/page-layout/types/PageLayoutWidget';
import { resolveRelatedObjectForFieldWidget } from '@/page-layout/utils/resolveRelatedObjectForFieldWidget';
import { filterFieldsForRecordTableViewCreation } from '@/page-layout/widgets/record-table/utils/filterFieldsForRecordTableViewCreation';
import { sortFieldsByRelevanceForRecordTableWidget } from '@/page-layout/widgets/record-table/utils/sortFieldsByRelevanceForRecordTableWidget';
import { usePerformViewAPIPersist } from '@/views/hooks/internal/usePerformViewAPIPersist';
import { usePerformViewFieldAPIPersist } from '@/views/hooks/internal/usePerformViewFieldAPIPersist';
import { useStore } from 'jotai';
import { useCallback } from 'react';
import { isDefined, isNonEmptyArray } from 'twenty-shared/utils';
import {
  FieldDisplayMode,
  ViewType,
  WidgetType,
} from '~/generated-metadata/graphql';
import { v4 } from 'uuid';

const DEFAULT_VIEW_FIELD_SIZE = 180;
const INITIAL_VISIBLE_FIELDS_COUNT_IN_WIDGET = 6;

export const useCreatePendingFieldWidgetTableViews = () => {
  const { performViewAPICreate } = usePerformViewAPIPersist();
  const { performViewFieldAPICreate, performViewFieldAPIUpdate } =
    usePerformViewFieldAPIPersist();
  const store = useStore();

  const persistDraftViewFields = useCallback(
    async (
      widget: PageLayoutWidget,
      viewId: string,
      pageLayoutId: string,
    ) => {
      const ungroupedDraft = store.get(
        fieldsWidgetUngroupedFieldsDraftComponentState.atomFamily({
          instanceId: pageLayoutId,
        }),
      );
      const draftFields = ungroupedDraft[widget.id] ?? [];

      if (!isNonEmptyArray(draftFields)) {
        return;
      }

      const fieldsToCreate = draftFields
        .filter((field) => !isDefined(field.viewFieldId))
        .map((field) => ({
          id: v4(),
          viewId,
          fieldMetadataId: field.fieldMetadataItem.id,
          position: field.position,
          size: DEFAULT_VIEW_FIELD_SIZE,
          isVisible: field.isVisible,
        }));

      const fieldsToUpdate = draftFields
        .filter((field) => isDefined(field.viewFieldId))
        .map((field) => ({
          input: {
            id: field.viewFieldId!,
            update: {
              isVisible: field.isVisible,
              position: field.position,
            },
          },
        }));

      if (isNonEmptyArray(fieldsToCreate)) {
        await performViewFieldAPICreate({ inputs: fieldsToCreate });
      }

      if (isNonEmptyArray(fieldsToUpdate)) {
        await performViewFieldAPIUpdate(fieldsToUpdate);
      }
    },
    [store, performViewFieldAPICreate, performViewFieldAPIUpdate],
  );

  const createPendingFieldWidgetTableViews = useCallback(
    async (pageLayoutId: string) => {
      const draft = store.get(
        pageLayoutDraftComponentState.atomFamily({
          instanceId: pageLayoutId,
        }),
      );
      const persisted = store.get(
        pageLayoutPersistedComponentState.atomFamily({
          instanceId: pageLayoutId,
        }),
      );

      const persistedViewIdsByWidgetId = new Map<string, string | null>();
      persisted?.tabs.forEach((tab) =>
        tab.widgets.forEach((widget) => {
          if (widget.configuration.configurationType === 'FIELD') {
            const config = widget.configuration as FieldConfiguration;
            persistedViewIdsByWidgetId.set(widget.id, config.viewId ?? null);
          }
        }),
      );

      const objectMetadataItems = store.get(objectMetadataItemsSelector.atom);

      const tableFieldWidgets = draft.tabs
        .flatMap((tab) => tab.widgets)
        .filter((widget) => {
          if (widget.type !== WidgetType.FIELD) {
            return false;
          }

          const config = widget.configuration as FieldConfiguration;

          if (config.fieldDisplayMode !== FieldDisplayMode.VIEW) {
            return false;
          }

          return isDefined(config.viewId);
        });

      const pendingWidgets = tableFieldWidgets.filter(
        (widget) =>
          persistedViewIdsByWidgetId.get(widget.id) !==
          (widget.configuration as FieldConfiguration).viewId,
      );

      const existingWidgetsWithDraft = tableFieldWidgets.filter((widget) => {
        const config = widget.configuration as FieldConfiguration;

        if (
          persistedViewIdsByWidgetId.get(widget.id) !== config.viewId
        ) {
          return false;
        }

        const ungroupedDraft = store.get(
          fieldsWidgetUngroupedFieldsDraftComponentState.atomFamily({
            instanceId: pageLayoutId,
          }),
        );

        return isNonEmptyArray(ungroupedDraft[widget.id]);
      });

      for (const widget of pendingWidgets) {
        const config = widget.configuration as FieldConfiguration;
        const viewId = config.viewId;

        if (!isDefined(viewId)) {
          continue;
        }

        const parentObjectMetadataId =
          widget.objectMetadataId ?? draft.objectMetadataId;

        if (!isDefined(parentObjectMetadataId)) {
          continue;
        }

        const resolved = resolveRelatedObjectForFieldWidget({
          objectMetadataItems,
          parentObjectMetadataId,
          fieldMetadataId: config.fieldMetadataId,
        });

        if (!isDefined(resolved)) {
          continue;
        }

        const { relatedObject } = resolved;

        const viewResult = await performViewAPICreate(
          {
            input: {
              id: viewId,
              name: `${relatedObject.labelPlural} Table`,
              icon: relatedObject.icon ?? 'IconTable',
              objectMetadataId: relatedObject.id,
              type: ViewType.TABLE_WIDGET,
            },
          },
          relatedObject.id,
        );

        if (viewResult.status === 'failed') {
          throw new Error(
            `Failed to create view for FIELD table widget ${widget.id}`,
          );
        }

        const ungroupedDraft = store.get(
          fieldsWidgetUngroupedFieldsDraftComponentState.atomFamily({
            instanceId: pageLayoutId,
          }),
        );

        if (isNonEmptyArray(ungroupedDraft[widget.id])) {
          await persistDraftViewFields(widget, viewId, pageLayoutId);
          continue;
        }

        const eligibleFields = relatedObject.fields.filter(
          filterFieldsForRecordTableViewCreation,
        );

        const sortedFields = eligibleFields.toSorted(
          sortFieldsByRelevanceForRecordTableWidget(
            relatedObject.labelIdentifierFieldMetadataId,
          ),
        );

        const viewFieldInputs = sortedFields.map((field, index) => ({
          id: v4(),
          viewId,
          fieldMetadataId: field.id,
          position: index,
          size: DEFAULT_VIEW_FIELD_SIZE,
          isVisible: index < INITIAL_VISIBLE_FIELDS_COUNT_IN_WIDGET,
        }));

        await performViewFieldAPICreate({ inputs: viewFieldInputs });
      }

      for (const widget of existingWidgetsWithDraft) {
        const config = widget.configuration as FieldConfiguration;
        const viewId = config.viewId;

        if (!isDefined(viewId)) {
          continue;
        }

        await persistDraftViewFields(widget, viewId, pageLayoutId);
      }
    },
    [
      performViewAPICreate,
      performViewFieldAPICreate,
      persistDraftViewFields,
      store,
    ],
  );

  return { createPendingFieldWidgetTableViews };
};
