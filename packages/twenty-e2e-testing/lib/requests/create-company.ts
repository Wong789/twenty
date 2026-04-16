import { type Page } from '@playwright/test';
import { getAccessAuthToken } from '../utils/getAccessAuthToken';
import { backendGraphQLUrl } from './backend';

export const createCompany = async ({
  page,
  companyName,
}: {
  page: Page;
  companyName: string;
}) => {
  const { authToken } = await getAccessAuthToken(page);

  const response = await page.request.post(backendGraphQLUrl, {
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
    data: {
      operationName: 'CreateOneCompany',
      query:
        'mutation CreateOneCompany($input: CompanyCreateInput!) { createCompany(data: $input) { __typename id } }',
      variables: {
        input: {
          name: companyName,
        },
      },
    },
  });

  const body = await response.json();

  return body.data.createCompany.id as string;
};
