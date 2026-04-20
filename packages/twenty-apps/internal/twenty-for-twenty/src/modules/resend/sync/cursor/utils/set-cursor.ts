import { CoreApiClient } from 'twenty-client-sdk/core';

export const setCursor = async (
  client: CoreApiClient,
  id: string,
  cursor: string | null,
): Promise<void> => {
  await client.mutation({
    updateResendSyncCursor: {
      __args: { id, data: { cursor } },
      id: true,
    },
  });
};
