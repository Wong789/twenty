import { type Page } from '@playwright/test';
import { getAccessAuthToken } from '../utils/getAccessAuthToken';
import { backendGraphQLUrl } from './backend';

export const deleteCompany = async ({
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
      operationName: 'DeleteOneCompany',
      variables: { idToDelete: companyId },
      query:
        'mutation DeleteOneCompany($idToDelete: UUID!) {\n  deleteCompany(id: $idToDelete) {\n    __typename\n    deletedAt\n    id\n  }\n}',
    },
  });
};
