import {
  RESEND_FOLDER_NAVIGATION_MENU_ITEM_UNIVERSAL_IDENTIFIER,
  RESEND_SYNC_STATUS_NAVIGATION_MENU_ITEM_UNIVERSAL_IDENTIFIER,
  RESEND_SYNC_STATUS_PAGE_LAYOUT_UNIVERSAL_IDENTIFIER,
} from '@modules/resend/constants/universal-identifiers';
import { defineNavigationMenuItem } from 'twenty-sdk/define';
import { NavigationMenuItemType } from 'twenty-sdk/define';

export default defineNavigationMenuItem({
  universalIdentifier:
    RESEND_SYNC_STATUS_NAVIGATION_MENU_ITEM_UNIVERSAL_IDENTIFIER,
  name: 'Sync Status',
  icon: 'IconRefresh',
  position: 100,
  type: NavigationMenuItemType.PAGE_LAYOUT,
  pageLayoutUniversalIdentifier:
    RESEND_SYNC_STATUS_PAGE_LAYOUT_UNIVERSAL_IDENTIFIER,
  folderUniversalIdentifier:
    RESEND_FOLDER_NAVIGATION_MENU_ITEM_UNIVERSAL_IDENTIFIER,
});
