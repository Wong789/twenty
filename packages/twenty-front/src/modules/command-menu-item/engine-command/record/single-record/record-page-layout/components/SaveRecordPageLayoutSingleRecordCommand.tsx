import { HeadlessEngineCommandWrapperEffect } from '@/command-menu-item/engine-command/components/HeadlessEngineCommandWrapperEffect';
import { useMountedEngineCommandContext } from '@/command-menu-item/engine-command/hooks/useMountedEngineCommandContext';
import { useRecordPageLayoutIdFromRecordStoreOrThrow } from '@/page-layout/hooks/common/useRecordPageLayoutIdFromRecordStoreOrThrow';
import { useSaveFieldsWidgetGroups } from '@/page-layout/hooks/edit/useSaveFieldsWidgetGroups';
import { useSavePageLayout } from '@/page-layout/hooks/edit/useSavePageLayout';
import { useSetIsPageLayoutInEditMode } from '@/page-layout/hooks/edit/useSetIsPageLayoutInEditMode';
import { useSidePanelMenu } from '@/side-panel/hooks/useSidePanelMenu';
import { isDefined } from 'twenty-shared/utils';

export const SaveRecordPageLayoutSingleRecordCommand = () => {
  const { objectMetadataItem } = useMountedEngineCommandContext();

  if (!isDefined(objectMetadataItem)) {
    throw new Error(
      'Object metadata item is required to save record page layout',
    );
  }

  const { pageLayoutId } = useRecordPageLayoutIdFromRecordStoreOrThrow({
    targetObjectNameSingular: objectMetadataItem.nameSingular,
  });

  const { savePageLayout } = useSavePageLayout(pageLayoutId);

  const { saveFieldsWidgetGroups } = useSaveFieldsWidgetGroups();

  const { setIsPageLayoutInEditMode } =
    useSetIsPageLayoutInEditMode(pageLayoutId);

  const { closeSidePanelMenu } = useSidePanelMenu();

  const handleExecute = async () => {
    const result = await savePageLayout();

    if (result.status === 'successful') {
      await saveFieldsWidgetGroups(pageLayoutId);

      closeSidePanelMenu();
      setIsPageLayoutInEditMode(false);
    }
  };

  return <HeadlessEngineCommandWrapperEffect execute={handleExecute} />;
};
