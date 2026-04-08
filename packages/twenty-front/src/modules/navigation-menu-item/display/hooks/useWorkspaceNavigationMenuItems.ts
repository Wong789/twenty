import { getObjectMetadataForNavigationMenuItem } from '@/navigation-menu-item/display/object/utils/getObjectMetadataForNavigationMenuItem';
import { objectMetadataItemsSelector } from '@/object-metadata/states/objectMetadataItemsSelector';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import { viewsSelector } from '@/views/states/selectors/viewsSelector';
import { NavigationMenuItemType } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';
import { useNavigationMenuItemsData } from './useNavigationMenuItemsData';

export const useWorkspaceNavigationMenuItems = (): {
  objectMetadataIdsInWorkspaceNav: Set<string>;
} => {
  const { workspaceNavigationMenuItems: rawWorkspaceNavigationMenuItems } =
    useNavigationMenuItemsData();
  const objectMetadataItems = useAtomStateValue(objectMetadataItemsSelector);
  const views = useAtomStateValue(viewsSelector);

  const objectMetadataIdsInWorkspaceNav = new Set(
    rawWorkspaceNavigationMenuItems
      .filter(
        (item) =>
          item.type === NavigationMenuItemType.OBJECT ||
          item.type === NavigationMenuItemType.VIEW,
      )
      .map(
        (item) =>
          getObjectMetadataForNavigationMenuItem(
            item,
            objectMetadataItems,
            views,
          )?.id,
      )
      .filter((objectMetadataId) => isDefined(objectMetadataId)),
  );

  return {
    objectMetadataIdsInWorkspaceNav,
  };
};
