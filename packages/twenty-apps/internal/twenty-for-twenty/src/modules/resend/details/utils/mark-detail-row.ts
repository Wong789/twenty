import type { CoreApiClient } from 'twenty-client-sdk/core';

const UPDATE_RESEND_DETAIL_TO_FETCH: string = 'updateResendDetailToFetch';

const updateRow = async (
  client: CoreApiClient,
  id: string,
  data: Record<string, unknown>,
): Promise<void> => {
  await client.mutation({
    [UPDATE_RESEND_DETAIL_TO_FETCH]: {
      __args: { id, data },
      id: true,
    },
  });
};

export const markDetailRowDone = async (
  client: CoreApiClient,
  rowId: string,
): Promise<void> => {
  await updateRow(client, rowId, {
    status: 'DONE',
    processedAt: new Date().toISOString(),
    lastError: null,
  });
};

export const markDetailRowFailed = async (
  client: CoreApiClient,
  rowId: string,
  previousRetryCount: number,
  errorMessage: string,
  isFinalFailure: boolean,
): Promise<void> => {
  await updateRow(client, rowId, {
    status: isFinalFailure ? 'FAILED' : 'PENDING',
    retryCount: previousRetryCount + 1,
    lastError: errorMessage,
    processedAt: isFinalFailure ? new Date().toISOString() : null,
  });
};
