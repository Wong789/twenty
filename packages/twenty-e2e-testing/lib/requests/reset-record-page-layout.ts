import { type Page } from '@playwright/test';
import { getAccessAuthToken } from '../utils/getAccessAuthToken';
import { metadataGraphQLUrl } from './backend';

export const resetRecordPageLayout = async ({
  page,
  objectNameSingular,
}: {
  page: Page;
  objectNameSingular: string;
}) => {
  const { authToken } = await getAccessAuthToken(page);

  const headers = {
    Authorization: `Bearer ${authToken}`,
  };

  // Step 1: Find the objectMetadataId for the given object name
  const objectsResponse = await page.request.post(metadataGraphQLUrl, {
    headers,
    data: {
      operationName: 'ObjectMetadataItems',
      query:
        'query ObjectMetadataItems { objects(paging: { first: 1000 }) { edges { node { id nameSingular } } } }',
    },
  });

  const objectsBody = await objectsResponse.json();

  const objectMetadataId = objectsBody.data.objects.edges.find(
    (edge: { node: { nameSingular: string } }) =>
      edge.node.nameSingular === objectNameSingular,
  )?.node.id as string | undefined;

  if (!objectMetadataId) {
    throw new Error(
      `Object metadata not found for nameSingular: ${objectNameSingular}`,
    );
  }

  // Step 2: Find all record page layouts for this object
  const layoutsResponse = await page.request.post(metadataGraphQLUrl, {
    headers,
    data: {
      operationName: 'GetPageLayouts',
      query:
        'query GetPageLayouts($objectMetadataId: String, $pageLayoutType: PageLayoutType) { getPageLayouts(objectMetadataId: $objectMetadataId, pageLayoutType: $pageLayoutType) { id } }',
      variables: {
        objectMetadataId,
        pageLayoutType: 'RECORD_PAGE',
      },
    },
  });

  const layoutsBody = await layoutsResponse.json();
  const layouts = layoutsBody.data.getPageLayouts as { id: string }[];

  // Step 3: Reset each layout to default
  for (const layout of layouts) {
    await page.request.post(metadataGraphQLUrl, {
      headers,
      data: {
        operationName: 'ResetPageLayoutToDefault',
        query:
          'mutation ResetPageLayoutToDefault($id: String!) { resetPageLayoutToDefault(id: $id) { id } }',
        variables: {
          id: layout.id,
        },
      },
    });
  }
};
