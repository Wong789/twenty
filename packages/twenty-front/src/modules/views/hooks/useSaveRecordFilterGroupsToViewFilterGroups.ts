import { metadataStoreState } from '@/metadata-store/states/metadataStoreState';
import { type FlatViewFilterGroup } from '@/metadata-store/types/FlatViewFilterGroup';
import { currentRecordFilterGroupsComponentState } from '@/object-record/record-filter-group/states/currentRecordFilterGroupsComponentState';
import { useAtomComponentStateCallbackState } from '@/ui/utilities/state/jotai/hooks/useAtomComponentStateCallbackState';
import { usePerformViewFilterGroupAPIPersist } from '@/views/hooks/internal/usePerformViewFilterGroupAPIPersist';
import { useCanPersistViewChanges } from '@/views/hooks/useCanPersistViewChanges';
import { useGetCurrentViewOnly } from '@/views/hooks/useGetCurrentViewOnly';
import { getViewFilterGroupsToCreate } from '@/views/utils/getViewFilterGroupsToCreate';
import { getViewFilterGroupsToDelete } from '@/views/utils/getViewFilterGroupsToDelete';
import { getViewFilterGroupsToUpdate } from '@/views/utils/getViewFilterGroupsToUpdate';
import { mapRecordFilterGroupToViewFilterGroup } from '@/views/utils/mapRecordFilterGroupToViewFilterGroup';
import { useStore } from 'jotai';
import { useCallback } from 'react';
import { isDefined } from 'twenty-shared/utils';

export const useSaveRecordFilterGroupsToViewFilterGroups = () => {
  const { canPersistChanges } = useCanPersistViewChanges();
  const {
    performViewFilterGroupAPICreate,
    performViewFilterGroupAPIUpdate,
    performViewFilterGroupAPIDelete,
  } = usePerformViewFilterGroupAPIPersist();

  const { currentView } = useGetCurrentViewOnly();

  const currentRecordFilterGroupsCallbackState =
    useAtomComponentStateCallbackState(currentRecordFilterGroupsComponentState);

  const store = useStore();

  const saveRecordFilterGroupsToViewFilterGroups = useCallback(async () => {
    if (!canPersistChanges || !isDefined(currentView)) {
      return;
    }

    const currentViewFilterGroups = currentView?.viewFilterGroups ?? [];

    const currentRecordFilterGroups = store.get(
      currentRecordFilterGroupsCallbackState,
    );

    const newViewFilterGroups = currentRecordFilterGroups.map(
      (recordFilterGroup) =>
        mapRecordFilterGroupToViewFilterGroup({
          recordFilterGroup,
          view: currentView,
        }),
    );

    const viewFilterGroupsToCreate = getViewFilterGroupsToCreate(
      currentViewFilterGroups,
      newViewFilterGroups,
    );

    const viewFilterGroupsToDelete = getViewFilterGroupsToDelete(
      currentViewFilterGroups,
      newViewFilterGroups,
    );

    const viewFilterGroupsToUpdate = getViewFilterGroupsToUpdate(
      currentViewFilterGroups,
      newViewFilterGroups,
    );

    const viewFilterGroupIdsToDelete = viewFilterGroupsToDelete.map(
      (viewFilterGroup) => viewFilterGroup.id,
    );

    await performViewFilterGroupAPICreate(
      viewFilterGroupsToCreate,
      currentView,
    );
    await performViewFilterGroupAPIUpdate(viewFilterGroupsToUpdate);
    await performViewFilterGroupAPIDelete(viewFilterGroupIdsToDelete);

    // Optimistically update the metadata store so the UI reflects
    // the saved state immediately, without waiting for the SSE round-trip.
    const viewFilterGroupsEntry = store.get(
      metadataStoreState.atomFamily('viewFilterGroups'),
    );
    const currentFlatViewFilterGroups = (
      viewFilterGroupsEntry.status === 'draft-pending'
        ? viewFilterGroupsEntry.draft
        : viewFilterGroupsEntry.current
    ) as FlatViewFilterGroup[];

    const otherViewFilterGroups = currentFlatViewFilterGroups.filter(
      (filterGroup) => filterGroup.viewId !== currentView.id,
    );

    const updatedViewFilterGroups = [
      ...otherViewFilterGroups,
      ...newViewFilterGroups.map((filterGroup) => ({
        ...filterGroup,
        viewId: currentView.id,
      })),
    ];

    store.set(metadataStoreState.atomFamily('viewFilterGroups'), {
      ...viewFilterGroupsEntry,
      current: updatedViewFilterGroups,
    });
  }, [
    canPersistChanges,
    currentView,
    store,
    currentRecordFilterGroupsCallbackState,
    performViewFilterGroupAPICreate,
    performViewFilterGroupAPIUpdate,
    performViewFilterGroupAPIDelete,
  ]);

  return {
    saveRecordFilterGroupsToViewFilterGroups,
  };
};
