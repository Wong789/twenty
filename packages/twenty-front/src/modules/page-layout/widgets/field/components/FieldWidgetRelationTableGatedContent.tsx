import { currentRecordFiltersComponentState } from '@/object-record/record-filter/states/currentRecordFiltersComponentState';
import { type RecordFilter } from '@/object-record/record-filter/types/RecordFilter';
import { RecordTableWidget } from '@/object-record/record-table-widget/components/RecordTableWidget';
import { lastLoadedRecordTableWidgetViewIdComponentState } from '@/object-record/record-table-widget/states/lastLoadedRecordTableWidgetViewIdComponentState';
import { FieldWidgetRelationTableShimmer } from '@/page-layout/widgets/field/components/FieldWidgetRelationTableShimmer';
import { useAtomComponentStateCallbackState } from '@/ui/utilities/state/jotai/hooks/useAtomComponentStateCallbackState';
import { useAtomComponentStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomComponentStateValue';
import { useStore } from 'jotai';
import { useEffect, useState } from 'react';
import { ViewFilterOperand } from '~/generated-metadata/graphql';

type FieldWidgetRelationTableGatedContentProps = {
  viewId: string;
  widgetId: string;
  inverseRelationFieldMetadataId: string;
  targetRecordId: string;
};

export const FieldWidgetRelationTableGatedContent = ({
  viewId,
  widgetId,
  inverseRelationFieldMetadataId,
  targetRecordId,
}: FieldWidgetRelationTableGatedContentProps) => {
  const [isScopedFilterReady, setIsScopedFilterReady] = useState(false);

  const lastLoadedRecordTableWidgetViewId = useAtomComponentStateValue(
    lastLoadedRecordTableWidgetViewIdComponentState,
  );

  const store = useStore();

  const lastLoadedAtom = useAtomComponentStateCallbackState(
    lastLoadedRecordTableWidgetViewIdComponentState,
  );

  const currentRecordFiltersAtom = useAtomComponentStateCallbackState(
    currentRecordFiltersComponentState,
  );

  useEffect(() => {
    const lastLoaded = store.get(lastLoadedAtom);

    if (lastLoaded?.viewId !== viewId) {
      setIsScopedFilterReady(false);
      return;
    }

    const filterId = `field-widget-relation-scope-${widgetId}`;

    const existingFilters = store.get(currentRecordFiltersAtom);
    const alreadyApplied = existingFilters.some(
      (filter) =>
        filter.id === filterId &&
        filter.fieldMetadataId === inverseRelationFieldMetadataId &&
        filter.value ===
          JSON.stringify({
            isCurrentWorkspaceMemberSelected: false,
            selectedRecordIds: [targetRecordId],
          }),
    );

    if (!alreadyApplied) {
      const scopedFilter: RecordFilter = {
        id: filterId,
        fieldMetadataId: inverseRelationFieldMetadataId,
        value: JSON.stringify({
          isCurrentWorkspaceMemberSelected: false,
          selectedRecordIds: [targetRecordId],
        }),
        displayValue: '',
        label: '',
        type: 'RELATION',
        operand: ViewFilterOperand.IS,
      };

      store.set(currentRecordFiltersAtom, [scopedFilter]);
    }

    setIsScopedFilterReady(true);
  }, [
    lastLoadedRecordTableWidgetViewId,
    viewId,
    widgetId,
    inverseRelationFieldMetadataId,
    targetRecordId,
    store,
    lastLoadedAtom,
    currentRecordFiltersAtom,
  ]);

  if (!isScopedFilterReady) {
    return <FieldWidgetRelationTableShimmer />;
  }

  return <RecordTableWidget />;
};
