import { useLingui } from '@lingui/react/macro';
import { useLocation, useParams } from 'react-router-dom';
import { NavigationMenuItemType } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';
import { AnimatedExpandableContainer } from 'twenty-ui/layout';

import { activeNavigationItemState } from '@/navigation-menu-item/common/states/activeNavigationItemState';
import { matchesRecordShowPathForObject } from '@/navigation-menu-item/common/utils/matchesRecordShowPathForObject';
import { useNavigationMenuItemsData } from '@/navigation-menu-item/display/hooks/useNavigationMenuItemsData';
import { useWorkspaceNavigationMenuItems } from '@/navigation-menu-item/display/hooks/useWorkspaceNavigationMenuItems';
import { getObjectMetadataForNavigationMenuItem } from '@/navigation-menu-item/display/object/utils/getObjectMetadataForNavigationMenuItem';
import { NavigationDrawerSectionForObjectMetadataItems } from '@/object-metadata/components/NavigationDrawerSectionForObjectMetadataItems';
import { useFilteredObjectMetadataItems } from '@/object-metadata/hooks/useFilteredObjectMetadataItems';
import { objectMetadataItemsSelector } from '@/object-metadata/states/objectMetadataItemsSelector';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import { viewsSelector } from '@/views/states/selectors/viewsSelector';

export const NavigationDrawerOpenedSection = () => {
  const { t } = useLingui();
  const { pathname } = useLocation();

  const { activeObjectMetadataItems } = useFilteredObjectMetadataItems();

  const { objectMetadataIdsWithObjectWorkspaceItem } =
    useWorkspaceNavigationMenuItems();

  const { workspaceNavigationMenuItems } = useNavigationMenuItemsData();
  const activeNavigationItem = useAtomStateValue(activeNavigationItemState);
  const objectMetadataItems = useAtomStateValue(objectMetadataItemsSelector);
  const views = useAtomStateValue(viewsSelector);

  const {
    objectNamePlural: currentObjectNamePlural,
    objectNameSingular: currentObjectNameSingular,
  } = useParams();

  const objectMetadataItem = activeObjectMetadataItems.find(
    (item) =>
      item.namePlural === currentObjectNamePlural ||
      item.nameSingular === currentObjectNameSingular,
  );

  const isOnRecordShowForCurrentObject =
    isDefined(objectMetadataItem) &&
    matchesRecordShowPathForObject(pathname, objectMetadataItem.nameSingular);

  const activeWorkspaceNavigationMenuItem = isDefined(activeNavigationItem)
    ? workspaceNavigationMenuItems.find(
        (item) => item.id === activeNavigationItem.navItemId,
      )
    : undefined;

  const objectMetadataForActiveWorkspaceNavItem = isDefined(
    activeWorkspaceNavigationMenuItem,
  )
    ? getObjectMetadataForNavigationMenuItem(
        activeWorkspaceNavigationMenuItem,
        objectMetadataItems,
        views,
      )
    : null;

  const isCurrentObjectActiveInNavigationState =
    isDefined(objectMetadataItem) &&
    isDefined(activeNavigationItem) &&
    activeNavigationItem.objectNameSingular === objectMetadataItem.nameSingular;

  const isActiveWorkspaceItemViewOrRecord =
    isDefined(activeWorkspaceNavigationMenuItem) &&
    (activeWorkspaceNavigationMenuItem.type === NavigationMenuItemType.VIEW ||
      activeWorkspaceNavigationMenuItem.type === NavigationMenuItemType.RECORD);

  const activeWorkspaceItemTargetsCurrentObjectMetadata =
    isDefined(objectMetadataItem) &&
    objectMetadataForActiveWorkspaceNavItem?.id === objectMetadataItem.id;

  const isOpenedSuppressedForViewOrRecordItem =
    isCurrentObjectActiveInNavigationState &&
    isActiveWorkspaceItemViewOrRecord &&
    activeWorkspaceItemTargetsCurrentObjectMetadata;

  const shouldShowOpenedSection =
    isDefined(objectMetadataItem) &&
    isOnRecordShowForCurrentObject &&
    !objectMetadataIdsWithObjectWorkspaceItem.has(objectMetadataItem.id) &&
    !isOpenedSuppressedForViewOrRecordItem;

  return (
    <AnimatedExpandableContainer isExpanded={shouldShowOpenedSection}>
      <NavigationDrawerSectionForObjectMetadataItems
        sectionTitle={t`Opened`}
        objectMetadataItems={
          isDefined(objectMetadataItem) ? [objectMetadataItem] : []
        }
      />
    </AnimatedExpandableContainer>
  );
};
