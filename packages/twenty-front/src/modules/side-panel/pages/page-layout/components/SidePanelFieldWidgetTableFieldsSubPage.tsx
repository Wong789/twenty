import { contextStoreCurrentObjectMetadataItemIdComponentState } from '@/context-store/states/contextStoreCurrentObjectMetadataItemIdComponentState';
import { ContextStoreComponentInstanceContext } from '@/context-store/states/contexts/ContextStoreComponentInstanceContext';
import { metadataStoreState } from '@/metadata-store/states/metadataStoreState';
import { type FlatViewField } from '@/metadata-store/types/FlatViewField';
import { useObjectMetadataItems } from '@/object-metadata/hooks/useObjectMetadataItems';
import { lastLoadedRecordTableWidgetViewIdComponentState } from '@/object-record/record-table-widget/states/lastLoadedRecordTableWidgetViewIdComponentState';
import { fieldsWidgetUngroupedFieldsDraftComponentState } from '@/page-layout/states/fieldsWidgetUngroupedFieldsDraftComponentState';
import { pageLayoutDraftComponentState } from '@/page-layout/states/pageLayoutDraftComponentState';
import { type FieldConfiguration } from '@/page-layout/types/FieldConfiguration';
import { resolveRelatedObjectForFieldWidget } from '@/page-layout/utils/resolveRelatedObjectForFieldWidget';
import { FieldsConfigurationEditor } from '@/page-layout/widgets/fields/components/FieldsConfigurationEditor';
import { FieldsWidgetGroupsDraftInitializationEffect } from '@/page-layout/widgets/fields/components/FieldsWidgetGroupsDraftInitializationEffect';
import { type FieldsWidgetGroupField } from '@/page-layout/widgets/fields/types/FieldsWidgetGroup';
import { usePageLayoutIdFromContextStore } from '@/side-panel/pages/page-layout/hooks/usePageLayoutIdFromContextStore';
import { useWidgetInEditMode } from '@/side-panel/pages/page-layout/hooks/useWidgetInEditMode';
import { useSetAtomComponentState } from '@/ui/utilities/state/jotai/hooks/useSetAtomComponentState';
import { useAtomComponentStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomComponentStateValue';
import { styled } from '@linaria/react';
import { useStore } from 'jotai';
import { useEffect, useState } from 'react';
import { isDefined } from 'twenty-shared/utils';
import { v4 } from 'uuid';
import { themeCssVariables } from 'twenty-ui/theme-constants';
import { FieldDisplayMode } from '~/generated-metadata/graphql';

const StyledFieldsLayoutContainer = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[3]};
  overflow-y: auto;
  padding: ${themeCssVariables.spacing[2]};
`;

const FIELD_WIDGET_TABLE_FIELDS_CONTEXT_STORE_INSTANCE_ID =
  'field-widget-table-fields-editor';

export const SidePanelFieldWidgetTableFieldsSubPage = () => {
  const { pageLayoutId } = usePageLayoutIdFromContextStore();
  const { widgetInEditMode } = useWidgetInEditMode(pageLayoutId);

  const pageLayoutDraft = useAtomComponentStateValue(
    pageLayoutDraftComponentState,
    pageLayoutId,
  );

  const { objectMetadataItems } = useObjectMetadataItems();

  if (!isDefined(widgetInEditMode)) {
    return null;
  }

  const fieldConfiguration =
    widgetInEditMode.configuration as FieldConfiguration;

  if (fieldConfiguration.fieldDisplayMode !== FieldDisplayMode.VIEW) {
    return null;
  }

  const parentObjectMetadataId =
    widgetInEditMode.objectMetadataId ?? pageLayoutDraft.objectMetadataId;

  if (!isDefined(parentObjectMetadataId)) {
    return null;
  }

  const resolved = resolveRelatedObjectForFieldWidget({
    objectMetadataItems,
    parentObjectMetadataId,
    fieldMetadataId: fieldConfiguration.fieldMetadataId,
  });

  if (!isDefined(resolved)) {
    return null;
  }

  return (
    <ContextStoreComponentInstanceContext.Provider
      value={{
        instanceId: FIELD_WIDGET_TABLE_FIELDS_CONTEXT_STORE_INSTANCE_ID,
      }}
    >
      <SidePanelFieldWidgetTableFieldsSubPageContent
        relatedObjectMetadataItemId={resolved.relatedObject.id}
        viewId={fieldConfiguration.viewId ?? null}
        pageLayoutId={pageLayoutId}
        widgetId={widgetInEditMode.id}
      />
    </ContextStoreComponentInstanceContext.Provider>
  );
};

const DEFAULT_VIEW_FIELD_SIZE = 180;

type FieldWidgetTableDraftToViewSyncEffectProps = {
  viewId: string | null;
  pageLayoutId: string;
  widgetId: string;
};

const FieldWidgetTableDraftToViewSyncEffect = ({
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

type SidePanelFieldWidgetTableFieldsSubPageContentProps = {
  relatedObjectMetadataItemId: string;
  viewId: string | null;
  pageLayoutId: string;
  widgetId: string;
};

const SidePanelFieldWidgetTableFieldsSubPageContent = ({
  relatedObjectMetadataItemId,
  viewId,
  pageLayoutId,
  widgetId,
}: SidePanelFieldWidgetTableFieldsSubPageContentProps) => {
  const setContextStoreCurrentObjectMetadataItemId = useSetAtomComponentState(
    contextStoreCurrentObjectMetadataItemIdComponentState,
  );

  const [isContextStoreReady, setIsContextStoreReady] = useState(false);

  useEffect(() => {
    setContextStoreCurrentObjectMetadataItemId(relatedObjectMetadataItemId);
    setIsContextStoreReady(true);
  }, [relatedObjectMetadataItemId, setContextStoreCurrentObjectMetadataItemId]);

  if (!isContextStoreReady) {
    return null;
  }

  return (
    <StyledFieldsLayoutContainer>
      <FieldsWidgetGroupsDraftInitializationEffect
        viewId={viewId}
        pageLayoutId={pageLayoutId}
        widgetId={widgetId}
      />
      <FieldWidgetTableDraftToViewSyncEffect
        viewId={viewId}
        pageLayoutId={pageLayoutId}
        widgetId={widgetId}
      />
      <FieldsConfigurationEditor
        pageLayoutId={pageLayoutId}
        widgetId={widgetId}
        hideAddGroup
      />
    </StyledFieldsLayoutContainer>
  );
};
