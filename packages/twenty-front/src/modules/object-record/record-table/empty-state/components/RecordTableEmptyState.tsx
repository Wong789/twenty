import { useFindManyRecords } from '@/object-record/hooks/useFindManyRecords';
import { useObjectPermissionsForObject } from '@/object-record/hooks/useObjectPermissionsForObject';
import { useRecordTableContextOrThrow } from '@/object-record/record-table/contexts/RecordTableContext';
import { RecordTableEmptyStateAccessDenied } from '@/object-record/record-table/empty-state/components/RecordTableEmptyStateAccessDenied';
import { RecordTableEmptyStateNoGroupNoRecordAtAll } from '@/object-record/record-table/empty-state/components/RecordTableEmptyStateNoGroupNoRecordAtAll';
import { RecordTableEmptyStateNoRecordFoundForFilter } from '@/object-record/record-table/empty-state/components/RecordTableEmptyStateNoRecordFoundForFilter';
import { RecordTableEmptyStateReadOnly } from '@/object-record/record-table/empty-state/components/RecordTableEmptyStateReadOnly';
import { RecordTableEmptyStateSoftDelete } from '@/object-record/record-table/empty-state/components/RecordTableEmptyStateSoftDelete';
import { isRecordTableAccessDeniedComponentState } from '@/object-record/record-table/states/isRecordTableAccessDeniedComponentState';
import { isSoftDeleteFilterActiveComponentState } from '@/object-record/record-table/states/isSoftDeleteFilterActiveComponentState';
import { useAtomComponentStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomComponentStateValue';

export const RecordTableEmptyState = () => {
  const { recordTableId, objectNameSingular, objectMetadataItem } =
    useRecordTableContextOrThrow();

  const isRecordTableAccessDenied = useAtomComponentStateValue(
    isRecordTableAccessDeniedComponentState,
    recordTableId,
  );

  const { totalCount } = useFindManyRecords({ objectNameSingular, limit: 1 });

  const isSoftDeleteFilterActive = useAtomComponentStateValue(
    isSoftDeleteFilterActiveComponentState,
    recordTableId,
  );

  const objectPermissions = useObjectPermissionsForObject(
    objectMetadataItem.id,
  );

  if (isRecordTableAccessDenied) {
    return <RecordTableEmptyStateAccessDenied />;
  }

  const noRecordAtAll = totalCount === 0;
  const hasObjectUpdatePermissions = objectPermissions.canUpdateObjectRecords;

  if (!hasObjectUpdatePermissions) {
    return <RecordTableEmptyStateReadOnly />;
  }

  if (isSoftDeleteFilterActive === true) {
    return <RecordTableEmptyStateSoftDelete />;
  } else if (noRecordAtAll) {
    return <RecordTableEmptyStateNoGroupNoRecordAtAll />;
  } else {
    return <RecordTableEmptyStateNoRecordFoundForFilter />;
  }
};
