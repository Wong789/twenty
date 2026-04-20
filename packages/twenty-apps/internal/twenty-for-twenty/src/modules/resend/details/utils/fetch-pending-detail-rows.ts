import { CoreApiClient } from 'twenty-client-sdk/core';
import { isDefined } from '@utils/is-defined';

import type { DetailToFetchRow } from '@modules/resend/details/types/detail-to-fetch';
import { extractConnection } from '@modules/resend/shared/utils/typed-client';

const RESEND_DETAILS_TO_FETCH_PLURAL: string = 'resendDetailsToFetch';

export const fetchPendingDetailRows = async (
  client: CoreApiClient,
  limit: number,
): Promise<DetailToFetchRow[]> => {
  if (limit <= 0) return [];

  const queryResult = await client.query({
    [RESEND_DETAILS_TO_FETCH_PLURAL]: {
      __args: {
        filter: {
          status: { eq: 'PENDING' },
        },
        orderBy: [{ queuedAt: 'AscNullsLast' }],
        first: limit,
      },
      edges: {
        node: {
          id: true,
          entityType: true,
          resendId: true,
          twentyRecordId: true,
          status: true,
          retryCount: true,
          lastError: true,
          queuedAt: true,
          processedAt: true,
        },
      },
    },
  });

  const connection = extractConnection<DetailToFetchRow>(
    queryResult,
    RESEND_DETAILS_TO_FETCH_PLURAL,
  );

  return connection.edges
    .map((edge) => edge.node)
    .filter((node): node is DetailToFetchRow => isDefined(node));
};
