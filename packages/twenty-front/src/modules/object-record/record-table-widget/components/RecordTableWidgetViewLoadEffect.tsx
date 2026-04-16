import { type EnrichedObjectMetadataItem } from '@/object-metadata/types/EnrichedObjectMetadataItem';
import { useLoadRecordIndexStates } from '@/object-record/record-index/hooks/useLoadRecordIndexStates';
import { lastLoadedRecordTableWidgetViewIdComponentState } from '@/object-record/record-table-widget/states/lastLoadedRecordTableWidgetViewIdComponentState';
import { useAtomComponentStateCallbackState } from '@/ui/utilities/state/jotai/hooks/useAtomComponentStateCallbackState';
import { useAtomFamilySelectorValue } from '@/ui/utilities/state/jotai/hooks/useAtomFamilySelectorValue';
import { viewFromViewIdFamilySelector } from '@/views/states/selectors/viewFromViewIdFamilySelector';
import { useStore } from 'jotai';
import { useEffect } from 'react';
import { isDefined } from 'twenty-shared/utils';

type RecordTableWidgetViewLoadEffectProps = {
  viewId: string;
  objectMetadataItem: EnrichedObjectMetadataItem;
};

export const RecordTableWidgetViewLoadEffect = ({
  viewId,
  objectMetadataItem,
}: RecordTableWidgetViewLoadEffectProps) => {
  const { loadRecordIndexStates } = useLoadRecordIndexStates();

  const store = useStore();

  const lastLoadedAtom = useAtomComponentStateCallbackState(
    lastLoadedRecordTableWidgetViewIdComponentState,
  );

  const viewFromViewId = useAtomFamilySelectorValue(
    viewFromViewIdFamilySelector,
    {
      viewId,
    },
  );

  const viewHasFields =
    isDefined(viewFromViewId) && viewFromViewId.viewFields.length > 0;

  useEffect(() => {
    if (!isDefined(viewFromViewId)) {
      return;
    }

    if (!viewHasFields) {
      return;
    }

    const lastLoaded = store.get(lastLoadedAtom);

    if (
      viewId === lastLoaded?.viewId &&
      objectMetadataItem.updatedAt === lastLoaded?.objectMetadataItemUpdatedAt
    ) {
      return;
    }

    store.set(lastLoadedAtom, {
      viewId,
      objectMetadataItemUpdatedAt: objectMetadataItem.updatedAt,
    });

    loadRecordIndexStates(viewFromViewId, objectMetadataItem);
  }, [
    viewId,
    viewFromViewId,
    viewHasFields,
    objectMetadataItem,
    store,
    lastLoadedAtom,
    loadRecordIndexStates,
  ]);

  return null;
};
