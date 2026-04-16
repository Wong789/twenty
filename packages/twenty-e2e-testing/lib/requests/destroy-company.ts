import { type Page } from '@playwright/test';
import { getAccessAuthToken } from '../utils/getAccessAuthToken';
import { backendGraphQLUrl } from './backend';

export const destroyCompany = async ({
  page,
  companyId,
}: {
  page: Page;
  companyId: string;
}) => {
  const { authToken } = await getAccessAuthToken(page);

  return page.request.post(backendGraphQLUrl, {
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
    data: {
      operationName: 'DestroyOneCompany',
      variables: { idToDestroy: companyId },
      query:
        'mutation DestroyOneCompany($idToDestroy: UUID!) {\n  destroyCompany(id: $idToDestroy) {\n    id\n    __typename\n  }\n}',
    },
  });
};
