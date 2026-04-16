import { useFieldMetadataItemById } from '@/object-metadata/hooks/useFieldMetadataItemById';
import { isDefined } from 'twenty-shared/utils';
import { useSeedDraftViewForFieldWidgetTable } from '@/page-layout/hooks/useSeedDraftViewForFieldWidgetTable';
import { useUpdatePageLayoutWidget } from '@/page-layout/hooks/useUpdatePageLayoutWidget';
import { useFieldWidgetEligibleFields } from '@/page-layout/widgets/field/hooks/useFieldWidgetEligibleFields';
import {
  getFieldWidgetDefaultDisplayMode,
  isDisplayModeValidForField,
} from '@/page-layout/widgets/field/utils/getFieldWidgetDisplayModeConfig';
import { usePageLayoutIdFromContextStore } from '@/side-panel/pages/page-layout/hooks/usePageLayoutIdFromContextStore';
import { useUpdateCurrentWidgetConfig } from '@/side-panel/pages/page-layout/hooks/useUpdateCurrentWidgetConfig';
import { useWidgetInEditMode } from '@/side-panel/pages/page-layout/hooks/useWidgetInEditMode';
import { DropdownMenuItemsContainer } from '@/ui/layout/dropdown/components/DropdownMenuItemsContainer';
import { DropdownMenuSearchInput } from '@/ui/layout/dropdown/components/DropdownMenuSearchInput';
import { DropdownMenuSeparator } from '@/ui/layout/dropdown/components/DropdownMenuSeparator';
import { DropdownComponentInstanceContext } from '@/ui/layout/dropdown/contexts/DropdownComponentInstanceContext';
import { useCloseDropdown } from '@/ui/layout/dropdown/hooks/useCloseDropdown';
import { SelectableList } from '@/ui/layout/selectable-list/components/SelectableList';
import { SelectableListItem } from '@/ui/layout/selectable-list/components/SelectableListItem';
import { selectedItemIdComponentState } from '@/ui/layout/selectable-list/states/selectedItemIdComponentState';
import { useAvailableComponentInstanceIdOrThrow } from '@/ui/utilities/state/component-state/hooks/useAvailableComponentInstanceIdOrThrow';
import { useAtomComponentStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomComponentStateValue';
import { t } from '@lingui/core/macro';
import { useState } from 'react';
import { useIcons } from 'twenty-ui/display';
import { MenuItemSelect } from 'twenty-ui/navigation';
import { v4 } from 'uuid';
import {
  FieldDisplayMode,
  type FieldConfiguration,
} from '~/generated-metadata/graphql';
import { filterBySearchQuery } from '~/utils/filterBySearchQuery';

export const FieldWidgetFieldDropdownContent = () => {
  const [searchQuery, setSearchQuery] = useState('');

  const { pageLayoutId, objectNameSingular } =
    usePageLayoutIdFromContextStore();

  const { widgetInEditMode } = useWidgetInEditMode(pageLayoutId);

  const fieldConfiguration = widgetInEditMode?.configuration as
    | FieldConfiguration
    | undefined;

  const currentFieldMetadataId = fieldConfiguration?.fieldMetadataId;

  const allFieldWidgetFieldMetadataItems =
    useFieldWidgetEligibleFields(objectNameSingular);

  const dropdownId = useAvailableComponentInstanceIdOrThrow(
    DropdownComponentInstanceContext,
  );

  const selectedItemId = useAtomComponentStateValue(
    selectedItemIdComponentState,
    dropdownId,
  );

  const { updateCurrentWidgetConfig } =
    useUpdateCurrentWidgetConfig(pageLayoutId);

  const { updatePageLayoutWidget } = useUpdatePageLayoutWidget(pageLayoutId);

  const { seedDraftViewForFieldWidgetTable } =
    useSeedDraftViewForFieldWidgetTable();

  const parentObjectMetadataId = widgetInEditMode?.objectMetadataId;

  const { closeDropdown } = useCloseDropdown();

  const { getIcon } = useIcons();

  const availableFields = filterBySearchQuery({
    items: allFieldWidgetFieldMetadataItems,
    searchQuery,
    getSearchableValues: (item) => [item.label],
  });

  const { fieldMetadataItem: currentFieldMetadataItem } =
    useFieldMetadataItemById(currentFieldMetadataId ?? '');

  const handleSelectField = (fieldMetadataId: string) => {
    const selectedField = allFieldWidgetFieldMetadataItems.find(
      (field) => field.id === fieldMetadataId,
    );

    const currentDisplayMode = fieldConfiguration?.fieldDisplayMode;

    const needsDisplayModeSwitch =
      isDefined(selectedField) &&
      isDefined(currentDisplayMode) &&
      !isDisplayModeValidForField(selectedField, currentDisplayMode);

    const staysInTableMode =
      currentDisplayMode === FieldDisplayMode.VIEW &&
      isDefined(selectedField) &&
      isDisplayModeValidForField(selectedField, FieldDisplayMode.VIEW);

    const nextViewId = staysInTableMode ? v4() : null;

    updateCurrentWidgetConfig({
      configToUpdate: {
        fieldMetadataId,
        viewId: nextViewId,
        ...(needsDisplayModeSwitch && {
          fieldDisplayMode: getFieldWidgetDefaultDisplayMode(
            selectedField.type,
          ),
        }),
      },
    });

    if (
      staysInTableMode &&
      isDefined(nextViewId) &&
      isDefined(parentObjectMetadataId)
    ) {
      seedDraftViewForFieldWidgetTable({
        viewId: nextViewId,
        fieldMetadataId,
        parentObjectMetadataId,
        pageLayoutId,
        widgetId: widgetInEditMode!.id,
      });
    }

    if (widgetInEditMode && selectedField) {
      updatePageLayoutWidget(widgetInEditMode.id, {
        title: selectedField.label,
      });
    }

    closeDropdown();
  };

  return (
    <>
      <DropdownMenuSearchInput
        autoFocus
        type="text"
        placeholder={t`Search fields`}
        onChange={(event) => setSearchQuery(event.target.value)}
        value={searchQuery}
      />
      <DropdownMenuSeparator />
      <DropdownMenuItemsContainer>
        <SelectableList
          selectableListInstanceId={dropdownId}
          focusId={dropdownId}
          selectableItemIdArray={availableFields.map((field) => field.id)}
        >
          {availableFields.map((fieldMetadataItem) => (
            <SelectableListItem
              key={fieldMetadataItem.id}
              itemId={fieldMetadataItem.id}
              onEnter={() => {
                handleSelectField(fieldMetadataItem.id);
              }}
            >
              <MenuItemSelect
                text={fieldMetadataItem.label}
                selected={currentFieldMetadataId === fieldMetadataItem.id}
                focused={selectedItemId === fieldMetadataItem.id}
                LeftIcon={getIcon(
                  currentFieldMetadataId === fieldMetadataItem.id
                    ? currentFieldMetadataItem?.icon
                    : fieldMetadataItem.icon,
                )}
                onClick={() => {
                  handleSelectField(fieldMetadataItem.id);
                }}
              />
            </SelectableListItem>
          ))}
        </SelectableList>
      </DropdownMenuItemsContainer>
    </>
  );
};
