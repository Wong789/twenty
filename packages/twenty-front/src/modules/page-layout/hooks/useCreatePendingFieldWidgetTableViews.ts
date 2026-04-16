import { objectMetadataItemsSelector } from '@/object-metadata/states/objectMetadataItemsSelector';
import { fieldsWidgetUngroupedFieldsDraftComponentState } from '@/page-layout/states/fieldsWidgetUngroupedFieldsDraftComponentState';
import { pageLayoutDraftComponentState } from '@/page-layout/states/pageLayoutDraftComponentState';
import { pageLayoutPersistedComponentState } from '@/page-layout/states/pageLayoutPersistedComponentState';
import { type FieldConfiguration } from '@/page-layout/types/FieldConfiguration';
import { type PageLayoutWidget } from '@/page-layout/types/PageLayoutWidget';
import { resolveRelatedObjectForFieldWidget } from '@/page-layout/utils/resolveRelatedObjectForFieldWidget';
import { DEFAULT_VIEW_FIELD_SIZE } from '@/page-layout/widgets/field/constants/fieldWidgetTableDefaults';
import { buildDefaultViewFieldInputs } from '@/page-layout/widgets/field/utils/buildDefaultViewFieldInputs';
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

type FieldWidgetWithConfig = PageLayoutWidget & {
  fieldConfig: FieldConfiguration;
};

export const useCreatePendingFieldWidgetTableViews = () => {
  const { performViewAPICreate } = usePerformViewAPIPersist();
  const { performViewFieldAPICreate, performViewFieldAPIUpdate } =
    usePerformViewFieldAPIPersist();
  const store = useStore();

  const persistDraftViewFields = useCallback(
    async (
      widget: PageLayoutWidget,
      viewId: string,
      ungroupedDraft: Record<
        string,
        Array<{
          viewFieldId?: string | null;
          fieldMetadataItem: { id: string };
          position: number;
          isVisible: boolean;
        }>
      >,
    ) => {
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
        .filter((field): field is typeof field & { viewFieldId: string } =>
          isDefined(field.viewFieldId),
        )
        .map((field) => ({
          input: {
            id: field.viewFieldId,
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
    [performViewFieldAPICreate, performViewFieldAPIUpdate],
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

      const ungroupedDraft = store.get(
        fieldsWidgetUngroupedFieldsDraftComponentState.atomFamily({
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

      const tableFieldWidgets: FieldWidgetWithConfig[] = draft.tabs
        .flatMap((tab) => tab.widgets)
        .filter(
          (
            widget,
          ): widget is PageLayoutWidget & { type: typeof WidgetType.FIELD } =>
            widget.type === WidgetType.FIELD,
        )
        .map((widget) => ({
          ...widget,
          fieldConfig: widget.configuration as FieldConfiguration,
        }))
        .filter(
          (widget) =>
            widget.fieldConfig.fieldDisplayMode === FieldDisplayMode.VIEW &&
            isDefined(widget.fieldConfig.viewId),
        );

      const pendingWidgets = tableFieldWidgets.filter(
        (widget) =>
          persistedViewIdsByWidgetId.get(widget.id) !==
          widget.fieldConfig.viewId,
      );

      const existingWidgetsWithDraft = tableFieldWidgets.filter((widget) => {
        if (
          persistedViewIdsByWidgetId.get(widget.id) !==
          widget.fieldConfig.viewId
        ) {
          return false;
        }

        return isNonEmptyArray(ungroupedDraft[widget.id]);
      });

      for (const widget of pendingWidgets) {
        const viewId = widget.fieldConfig.viewId;

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
          fieldMetadataId: widget.fieldConfig.fieldMetadataId,
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

        if (isNonEmptyArray(ungroupedDraft[widget.id])) {
          await persistDraftViewFields(widget, viewId, ungroupedDraft);
          continue;
        }

        const viewFieldInputs = buildDefaultViewFieldInputs({
          relatedObject,
          viewId,
        });

        await performViewFieldAPICreate({ inputs: viewFieldInputs });
      }

      for (const widget of existingWidgetsWithDraft) {
        const viewId = widget.fieldConfig.viewId;

        if (!isDefined(viewId)) {
          continue;
        }

        await persistDraftViewFields(widget, viewId, ungroupedDraft);
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
