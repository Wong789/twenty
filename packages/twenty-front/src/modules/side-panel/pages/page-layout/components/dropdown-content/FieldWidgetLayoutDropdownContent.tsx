import { useFieldMetadataItemById } from '@/object-metadata/hooks/useFieldMetadataItemById';
import { useSeedDraftViewForFieldWidgetTable } from '@/page-layout/hooks/useSeedDraftViewForFieldWidgetTable';
import { getFieldWidgetAvailableDisplayModesForField } from '@/page-layout/widgets/field/utils/getFieldWidgetDisplayModeConfig';
import { usePageLayoutIdFromContextStore } from '@/side-panel/pages/page-layout/hooks/usePageLayoutIdFromContextStore';
import { useUpdateCurrentWidgetConfig } from '@/side-panel/pages/page-layout/hooks/useUpdateCurrentWidgetConfig';
import { useWidgetInEditMode } from '@/side-panel/pages/page-layout/hooks/useWidgetInEditMode';
import { DropdownMenuItemsContainer } from '@/ui/layout/dropdown/components/DropdownMenuItemsContainer';
import { DropdownComponentInstanceContext } from '@/ui/layout/dropdown/contexts/DropdownComponentInstanceContext';
import { useCloseDropdown } from '@/ui/layout/dropdown/hooks/useCloseDropdown';
import { SelectableList } from '@/ui/layout/selectable-list/components/SelectableList';
import { SelectableListItem } from '@/ui/layout/selectable-list/components/SelectableListItem';
import { selectedItemIdComponentState } from '@/ui/layout/selectable-list/states/selectedItemIdComponentState';
import { useAvailableComponentInstanceIdOrThrow } from '@/ui/utilities/state/component-state/hooks/useAvailableComponentInstanceIdOrThrow';
import { useAtomComponentStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomComponentStateValue';
import { useLingui } from '@lingui/react/macro';
import { useMemo } from 'react';
import {
  type IconComponent,
  IconFileText,
  IconLayoutKanban,
  IconListDetails,
  IconTable,
} from 'twenty-ui/display';
import { MenuItemSelect } from 'twenty-ui/navigation';
import { isDefined } from 'twenty-shared/utils';
import { v4 } from 'uuid';
import {
  FieldDisplayMode,
  type FieldConfiguration,
} from '~/generated-metadata/graphql';

const DISPLAY_MODE_ICONS: Record<FieldDisplayMode, IconComponent> = {
  [FieldDisplayMode.FIELD]: IconListDetails,
  [FieldDisplayMode.CARD]: IconLayoutKanban,
  [FieldDisplayMode.EDITOR]: IconFileText,
  [FieldDisplayMode.VIEW]: IconTable,
};

export const FieldWidgetLayoutDropdownContent = () => {
  const { t } = useLingui();

  const { pageLayoutId } = usePageLayoutIdFromContextStore();

  const { widgetInEditMode } = useWidgetInEditMode(pageLayoutId);

  const fieldConfiguration = widgetInEditMode?.configuration as
    | FieldConfiguration
    | undefined;

  const currentDisplayMode = fieldConfiguration?.fieldDisplayMode;
  const currentFieldMetadataId = fieldConfiguration?.fieldMetadataId;
  const currentViewId = fieldConfiguration?.viewId;

  const { fieldMetadataItem } = useFieldMetadataItemById(
    currentFieldMetadataId ?? '',
  );

  const layoutOptions = useMemo(
    () =>
      fieldMetadataItem
        ? getFieldWidgetAvailableDisplayModesForField(fieldMetadataItem)
        : [FieldDisplayMode.FIELD],
    [fieldMetadataItem],
  );

  const dropdownId = useAvailableComponentInstanceIdOrThrow(
    DropdownComponentInstanceContext,
  );

  const selectedItemId = useAtomComponentStateValue(
    selectedItemIdComponentState,
    dropdownId,
  );

  const { updateCurrentWidgetConfig } =
    useUpdateCurrentWidgetConfig(pageLayoutId);

  const { seedDraftViewForFieldWidgetTable } =
    useSeedDraftViewForFieldWidgetTable();

  const { closeDropdown } = useCloseDropdown();

  const parentObjectMetadataId = widgetInEditMode?.objectMetadataId;

  const handleSelectLayout = (fieldDisplayMode: FieldDisplayMode) => {
    // Generate a viewId up-front for VIEW mode so the draft carries it; the
    // actual TABLE_WIDGET view is created on Save. Null it on any other mode
    // so an abandoned selection does not leak a pending view creation.
    const nextViewId =
      fieldDisplayMode === FieldDisplayMode.VIEW
        ? (currentViewId ?? v4())
        : null;

    updateCurrentWidgetConfig({
      configToUpdate: {
        fieldDisplayMode,
        viewId: nextViewId,
      },
    });

    // Seed a synthetic view into the client metadata store so RecordTableWidget
    // can render immediately, before the real view is persisted on Save.
    if (
      fieldDisplayMode === FieldDisplayMode.VIEW &&
      isDefined(nextViewId) &&
      isDefined(currentFieldMetadataId) &&
      isDefined(parentObjectMetadataId)
    ) {
      seedDraftViewForFieldWidgetTable({
        viewId: nextViewId,
        fieldMetadataId: currentFieldMetadataId,
        parentObjectMetadataId,
        pageLayoutId,
        widgetId: widgetInEditMode!.id,
      });
    }

    closeDropdown();
  };

  const layoutLabels: Record<string, string> = {
    [FieldDisplayMode.FIELD]: t`Field`,
    [FieldDisplayMode.CARD]: t`Card`,
    [FieldDisplayMode.EDITOR]: t`Editor`,
    [FieldDisplayMode.VIEW]: t`Table`,
  };

  return (
    <DropdownMenuItemsContainer>
      <SelectableList
        selectableListInstanceId={dropdownId}
        focusId={dropdownId}
        selectableItemIdArray={layoutOptions}
      >
        {layoutOptions.map((displayMode) => (
          <SelectableListItem
            key={displayMode}
            itemId={displayMode}
            onEnter={() => {
              handleSelectLayout(displayMode);
            }}
          >
            <MenuItemSelect
              text={layoutLabels[displayMode]}
              selected={currentDisplayMode === displayMode}
              focused={selectedItemId === displayMode}
              LeftIcon={DISPLAY_MODE_ICONS[displayMode]}
              onClick={() => {
                handleSelectLayout(displayMode);
              }}
            />
          </SelectableListItem>
        ))}
      </SelectableList>
    </DropdownMenuItemsContainer>
  );
};
