import { MetadataApiClient } from 'twenty-client-sdk/metadata';

import { INITIAL_SYNC_MODE_ENV_VAR_NAME } from '@modules/resend/constants/sync-config';

export type InitialSyncModeValue = 'true' | 'false';

export const setInitialSyncMode = async (
  value: InitialSyncModeValue,
): Promise<void> => {
  const applicationId = process.env.APPLICATION_ID;

  if (typeof applicationId !== 'string' || applicationId.length === 0) {
    throw new Error(
      'APPLICATION_ID is not available in the logic function environment',
    );
  }

  const metadataClient = new MetadataApiClient();

  await metadataClient.mutation({
    updateOneApplicationVariable: {
      __args: {
        key: INITIAL_SYNC_MODE_ENV_VAR_NAME,
        value,
        applicationId,
      },
    },
  });
};

export const isInitialSyncModeOn = (): boolean =>
  process.env[INITIAL_SYNC_MODE_ENV_VAR_NAME] === 'true';
