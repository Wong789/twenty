import { PageLayoutComponentInstanceContext } from '@/page-layout/states/contexts/PageLayoutComponentInstanceContext';
import { fieldsWidgetEditorModeDraftComponentState } from '@/page-layout/states/fieldsWidgetEditorModeDraftComponentState';
import { fieldsWidgetGroupsDraftComponentState } from '@/page-layout/states/fieldsWidgetGroupsDraftComponentState';
import { fieldsWidgetUngroupedFieldsDraftComponentState } from '@/page-layout/states/fieldsWidgetUngroupedFieldsDraftComponentState';
import { hasInitializedFieldsWidgetGroupsDraftComponentState } from '@/page-layout/states/hasInitializedFieldsWidgetGroupsDraftComponentState';
import { useAvailableComponentInstanceIdOrThrow } from '@/ui/utilities/state/component-state/hooks/useAvailableComponentInstanceIdOrThrow';
import { useAtomComponentStateCallbackState } from '@/ui/utilities/state/jotai/hooks/useAtomComponentStateCallbackState';
import { useStore } from 'jotai';
import { useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';

export const useCopyFieldsWidgetDraftState = (
  pageLayoutIdFromProps: string,
) => {
  const pageLayoutId = useAvailableComponentInstanceIdOrThrow(
    PageLayoutComponentInstanceContext,
    pageLayoutIdFromProps,
  );

  const fieldsWidgetGroupsDraftState = useAtomComponentStateCallbackState(
    fieldsWidgetGroupsDraftComponentState,
    pageLayoutId,
  );

  const fieldsWidgetUngroupedFieldsDraftState =
    useAtomComponentStateCallbackState(
      fieldsWidgetUngroupedFieldsDraftComponentState,
      pageLayoutId,
    );

  const fieldsWidgetEditorModeDraftState = useAtomComponentStateCallbackState(
    fieldsWidgetEditorModeDraftComponentState,
    pageLayoutId,
  );

  const hasInitializedFieldsWidgetGroupsDraftState =
    useAtomComponentStateCallbackState(
      hasInitializedFieldsWidgetGroupsDraftComponentState,
      pageLayoutId,
    );

  const store = useStore();

  const copyFieldsWidgetDraftState = useCallback(
    (sourceWidgetId: string, targetWidgetId: string) => {
      const groupsDraft = store.get(fieldsWidgetGroupsDraftState);
      const ungroupedFieldsDraft = store.get(
        fieldsWidgetUngroupedFieldsDraftState,
      );
      const editorModeDraft = store.get(fieldsWidgetEditorModeDraftState);

      let hasCopiedData = false;

      if (sourceWidgetId in groupsDraft) {
        const sourceGroups = groupsDraft[sourceWidgetId];
        const clonedGroups = sourceGroups.map((group) => ({
          ...group,
          id: uuidv4(),
          fields: group.fields.map((field) => ({
            ...field,
            viewFieldId: undefined,
          })),
        }));
        store.set(fieldsWidgetGroupsDraftState, (prev) => ({
          ...prev,
          [targetWidgetId]: clonedGroups,
        }));
        hasCopiedData = true;
      }

      if (sourceWidgetId in ungroupedFieldsDraft) {
        const sourceUngrouped = ungroupedFieldsDraft[sourceWidgetId];
        const clonedUngrouped = sourceUngrouped.map((field) => ({
          ...field,
          viewFieldId: undefined,
        }));
        store.set(fieldsWidgetUngroupedFieldsDraftState, (prev) => ({
          ...prev,
          [targetWidgetId]: clonedUngrouped,
        }));
        hasCopiedData = true;
      }

      if (sourceWidgetId in editorModeDraft) {
        store.set(fieldsWidgetEditorModeDraftState, (prev) => ({
          ...prev,
          [targetWidgetId]: editorModeDraft[sourceWidgetId],
        }));
        hasCopiedData = true;
      }

      if (hasCopiedData) {
        store.set(hasInitializedFieldsWidgetGroupsDraftState, (prev) => ({
          ...prev,
          [targetWidgetId]: true,
        }));
      }
    },
    [
      fieldsWidgetEditorModeDraftState,
      fieldsWidgetGroupsDraftState,
      fieldsWidgetUngroupedFieldsDraftState,
      hasInitializedFieldsWidgetGroupsDraftState,
      store,
    ],
  );

  return { copyFieldsWidgetDraftState };
};
