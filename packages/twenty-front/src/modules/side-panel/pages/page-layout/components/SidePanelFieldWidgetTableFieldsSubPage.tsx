import { contextStoreCurrentObjectMetadataItemIdComponentState } from '@/context-store/states/contextStoreCurrentObjectMetadataItemIdComponentState';
import { ContextStoreComponentInstanceContext } from '@/context-store/states/contexts/ContextStoreComponentInstanceContext';
import { useObjectMetadataItems } from '@/object-metadata/hooks/useObjectMetadataItems';
import { pageLayoutDraftComponentState } from '@/page-layout/states/pageLayoutDraftComponentState';
import { type FieldConfiguration } from '@/page-layout/types/FieldConfiguration';
import { resolveRelatedObjectForFieldWidget } from '@/page-layout/utils/resolveRelatedObjectForFieldWidget';
import { FieldWidgetTableDraftToViewSyncEffect } from '@/page-layout/widgets/field/components/FieldWidgetTableDraftToViewSyncEffect';
import { FieldsConfigurationEditor } from '@/page-layout/widgets/fields/components/FieldsConfigurationEditor';
import { FieldsWidgetGroupsDraftInitializationEffect } from '@/page-layout/widgets/fields/components/FieldsWidgetGroupsDraftInitializationEffect';
import { usePageLayoutIdFromContextStore } from '@/side-panel/pages/page-layout/hooks/usePageLayoutIdFromContextStore';
import { useWidgetInEditMode } from '@/side-panel/pages/page-layout/hooks/useWidgetInEditMode';
import { useSetAtomComponentState } from '@/ui/utilities/state/jotai/hooks/useSetAtomComponentState';
import { useAtomComponentStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomComponentStateValue';
import { styled } from '@linaria/react';
import { useEffect, useState } from 'react';
import { isDefined } from 'twenty-shared/utils';
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
