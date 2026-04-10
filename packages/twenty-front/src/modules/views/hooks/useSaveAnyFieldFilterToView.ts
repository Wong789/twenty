import { metadataStoreState } from '@/metadata-store/states/metadataStoreState';
import { type FlatView } from '@/metadata-store/types/FlatView';
import { anyFieldFilterValueComponentState } from '@/object-record/record-filter/states/anyFieldFilterValueComponentState';
import { useAtomComponentStateCallbackState } from '@/ui/utilities/state/jotai/hooks/useAtomComponentStateCallbackState';
import { usePerformViewAPIUpdate } from '@/views/hooks/internal/usePerformViewAPIUpdate';
import { useCanPersistViewChanges } from '@/views/hooks/useCanPersistViewChanges';
import { useGetCurrentViewOnly } from '@/views/hooks/useGetCurrentViewOnly';
import { convertUpdateViewInputToGql } from '@/views/utils/convertUpdateViewInputToGql';
import { useStore } from 'jotai';
import { useCallback } from 'react';
import { isDefined } from 'twenty-shared/utils';

export const useSaveAnyFieldFilterToView = () => {
  const { canPersistChanges } = useCanPersistViewChanges();
  const { performViewAPIUpdate } = usePerformViewAPIUpdate();

  const { currentView } = useGetCurrentViewOnly();

  const anyFieldFilterValueCallbackState = useAtomComponentStateCallbackState(
    anyFieldFilterValueComponentState,
  );

  const store = useStore();

  const saveAnyFieldFilterToView = useCallback(async () => {
    if (!canPersistChanges || !isDefined(currentView)) {
      return;
    }

    const currentViewAnyFieldFilterValue = currentView.anyFieldFilterValue;

    const currentAnyFieldFilterValue = store.get(
      anyFieldFilterValueCallbackState,
    );

    if (currentAnyFieldFilterValue !== currentViewAnyFieldFilterValue) {
      await performViewAPIUpdate({
        id: currentView.id,
        input: convertUpdateViewInputToGql({
          ...currentView,
          anyFieldFilterValue: currentAnyFieldFilterValue,
        }),
      });

      // Optimistically update the metadata store so the UI reflects
      // the saved state immediately, without waiting for the SSE round-trip.
      const viewsEntry = store.get(metadataStoreState.atomFamily('views'));
      const currentFlatViews = (
        viewsEntry.status === 'draft-pending'
          ? viewsEntry.draft
          : viewsEntry.current
      ) as FlatView[];

      const updatedViews = currentFlatViews.map((view) =>
        view.id === currentView.id
          ? { ...view, anyFieldFilterValue: currentAnyFieldFilterValue }
          : view,
      );

      store.set(metadataStoreState.atomFamily('views'), {
        ...viewsEntry,
        current: updatedViews,
      });
    }
  }, [
    store,
    canPersistChanges,
    performViewAPIUpdate,
    anyFieldFilterValueCallbackState,
    currentView,
  ]);

  return {
    saveAnyFieldFilterToView,
  };
};
