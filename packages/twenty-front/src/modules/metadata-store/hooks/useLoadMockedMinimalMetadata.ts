import { useMetadataStore } from '@/metadata-store/hooks/useMetadataStore';
import { splitObjectMetadataGqlResponse } from '@/metadata-store/utils/splitObjectMetadataGqlResponse';
import { splitViewWithRelated } from '@/metadata-store/utils/splitViewWithRelated';
import { useCallback } from 'react';

const MOCKED_COLLECTION_HASH = 'mocked';

export const useLoadMockedMinimalMetadata = () => {
  const { replaceDraft, applyChanges, resetMetadataStore } = useMetadataStore();

  const loadMockedMinimalMetadata = useCallback(async () => {
    // Load object metadata first — it's the only data needed for the
    // sign-in background mock table to render. Views and navigation
    // menu items are cosmetic and can be loaded after the first paint.
    const { mockedStandardObjectMetadataQueryResult } = await import(
      '~/testing/mock-data/generated/metadata/objects/mock-objects-metadata'
    );

    // Reset after async import so reset + replaceDraft + applyChanges
    // run in the same synchronous block (React 18 batches them into one render),
    // avoiding a window where the store appears empty to subscribers.
    resetMetadataStore();

    const { flatObjects, flatFields, flatIndexes } =
      splitObjectMetadataGqlResponse(mockedStandardObjectMetadataQueryResult);

    replaceDraft('objectMetadataItems', flatObjects, MOCKED_COLLECTION_HASH);
    replaceDraft('fieldMetadataItems', flatFields, MOCKED_COLLECTION_HASH);
    replaceDraft('indexMetadataItems', flatIndexes, MOCKED_COLLECTION_HASH);

    applyChanges();

    // Defer non-critical mock data (views, navigation) so they don't
    // compete for bandwidth with the main bundle during pageload.
    const [{ mockedViews }, { mockedNavigationMenuItems }] = await Promise.all([
      import('~/testing/mock-data/generated/metadata/views/mock-views-data'),
      import(
        '~/testing/mock-data/generated/metadata/navigation-menu-items/mock-navigation-menu-items-data'
      ),
    ]);

    const {
      flatViews,
      flatViewFields,
      flatViewFilters,
      flatViewSorts,
      flatViewGroups,
      flatViewFilterGroups,
      flatViewFieldGroups,
    } = splitViewWithRelated(mockedViews);

    replaceDraft('views', flatViews, MOCKED_COLLECTION_HASH);
    replaceDraft('viewFields', flatViewFields, MOCKED_COLLECTION_HASH);
    replaceDraft('viewFilters', flatViewFilters, MOCKED_COLLECTION_HASH);
    replaceDraft('viewSorts', flatViewSorts, MOCKED_COLLECTION_HASH);
    replaceDraft('viewGroups', flatViewGroups, MOCKED_COLLECTION_HASH);
    replaceDraft(
      'viewFilterGroups',
      flatViewFilterGroups,
      MOCKED_COLLECTION_HASH,
    );
    replaceDraft(
      'viewFieldGroups',
      flatViewFieldGroups,
      MOCKED_COLLECTION_HASH,
    );

    replaceDraft(
      'navigationMenuItems',
      mockedNavigationMenuItems,
      MOCKED_COLLECTION_HASH,
    );

    applyChanges();
  }, [replaceDraft, applyChanges, resetMetadataStore]);

  return { loadMockedMinimalMetadata };
};
