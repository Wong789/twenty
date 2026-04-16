import { metadataStoreState } from '@/metadata-store/states/metadataStoreState';
import { type FlatViewField } from '@/metadata-store/types/FlatViewField';
import { lastLoadedRecordTableWidgetViewIdComponentState } from '@/object-record/record-table-widget/states/lastLoadedRecordTableWidgetViewIdComponentState';
import { fieldsWidgetUngroupedFieldsDraftComponentState } from '@/page-layout/states/fieldsWidgetUngroupedFieldsDraftComponentState';
import { DEFAULT_VIEW_FIELD_SIZE } from '@/page-layout/widgets/field/constants/fieldWidgetTableDefaults';
import { type FieldsWidgetGroupField } from '@/page-layout/widgets/fields/types/FieldsWidgetGroup';
import { useAtomComponentStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomComponentStateValue';
import { useStore } from 'jotai';
import { useEffect } from 'react';
import { isDefined } from 'twenty-shared/utils';
import { v4 } from 'uuid';

type FieldWidgetTableDraftToViewSyncEffectProps = {
  viewId: string | null;
  pageLayoutId: string;
  widgetId: string;
};

export const FieldWidgetTableDraftToViewSyncEffect = ({
  viewId,
  pageLayoutId,
  widgetId,
}: FieldWidgetTableDraftToViewSyncEffectProps) => {
  const store = useStore();

  const ungroupedDraft = useAtomComponentStateValue(
    fieldsWidgetUngroupedFieldsDraftComponentState,
    pageLayoutId,
  );

  const widgetDraftFields: FieldsWidgetGroupField[] =
    ungroupedDraft[widgetId] ?? [];

  useEffect(() => {
    if (!isDefined(viewId) || widgetDraftFields.length === 0) {
      return;
    }

    const viewFieldsEntry = store.get(
      metadataStoreState.atomFamily('viewFields'),
    );
    const currentViewFields = viewFieldsEntry.current as FlatViewField[];

    const currentViewFieldsForThisView = currentViewFields.filter(
      (viewField) => viewField.viewId === viewId,
    );

    const hasChanges = widgetDraftFields.some((draftField) => {
      const existing = currentViewFieldsForThisView.find(
        (viewField) =>
          viewField.id === draftField.viewFieldId ||
          viewField.fieldMetadataId === draftField.fieldMetadataItem.id,
      );

      if (!isDefined(existing)) {
        return true;
      }

      return (
        existing.isVisible !== draftField.isVisible ||
        existing.position !== draftField.position
      );
    });

    if (!hasChanges) {
      return;
    }

    const otherViewFields = currentViewFields.filter(
      (viewField) => viewField.viewId !== viewId,
    );

    const draftViewFields: FlatViewField[] = widgetDraftFields.map(
      (draftField) => {
        const existingViewField = currentViewFieldsForThisView.find(
          (viewField) =>
            viewField.id === draftField.viewFieldId ||
            viewField.fieldMetadataId === draftField.fieldMetadataItem.id,
        );

        return {
          id: existingViewField?.id ?? draftField.viewFieldId ?? v4(),
          viewId,
          fieldMetadataId: draftField.fieldMetadataItem.id,
          position: draftField.position,
          size: existingViewField?.size ?? DEFAULT_VIEW_FIELD_SIZE,
          isVisible: draftField.isVisible,
          isActive: true,
        };
      },
    );

    store.set(metadataStoreState.atomFamily('viewFields'), {
      ...viewFieldsEntry,
      current: [...otherViewFields, ...draftViewFields],
    });

    store.set(
      lastLoadedRecordTableWidgetViewIdComponentState.atomFamily({
        instanceId: `record-table-widget-${widgetId}`,
      }),
      null,
    );
  }, [widgetDraftFields, viewId, store, widgetId]);

  return null;
};
