import { isDefined } from '@utils/is-defined';
import { MetadataApiClient } from 'twenty-client-sdk/metadata';
import { defineFrontComponent } from 'twenty-sdk/define';
import { Command, enqueueSnackbar } from 'twenty-sdk/front-component';

import { APPLICATION_UNIVERSAL_IDENTIFIER } from '@constants/universal-identifiers';
import { INITIAL_SYNC_MODE_ENV_VAR_NAME } from '@modules/resend/constants/sync-config';
import {
  SYNC_RESEND_DATA_COMMAND_UNIVERSAL_IDENTIFIER,
  SYNC_RESEND_DATA_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER,
} from '@modules/resend/constants/universal-identifiers';

const resolveApplicationId = async (
  metadataClient: MetadataApiClient,
): Promise<string> => {
  const { findManyApplications } = await metadataClient.query({
    findManyApplications: {
      id: true,
      universalIdentifier: true,
    },
  });

  const match = findManyApplications.find(
    (application: { universalIdentifier: string }) =>
      application.universalIdentifier === APPLICATION_UNIVERSAL_IDENTIFIER,
  );

  if (!isDefined(match)) {
    throw new Error('Twenty-for-Twenty application not found');
  }

  return match.id;
};

const flipInitialSyncModeOn = async (
  metadataClient: MetadataApiClient,
  applicationId: string,
): Promise<void> => {
  await metadataClient.mutation({
    updateOneApplicationVariable: {
      __args: {
        key: INITIAL_SYNC_MODE_ENV_VAR_NAME,
        value: 'true',
        applicationId,
      },
    },
  });
};

const execute = async () => {
  const metadataClient = new MetadataApiClient();

  const applicationId = await resolveApplicationId(metadataClient);

  await flipInitialSyncModeOn(metadataClient, applicationId);

  await enqueueSnackbar({
    message: 'Initial sync triggered — it will run in the background.',
    variant: 'success',
  });
};

const SyncResendData = () => <Command execute={execute} />;

export default defineFrontComponent({
  universalIdentifier: SYNC_RESEND_DATA_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER,
  name: 'Sync Resend Data',
  description:
    'Flips the application into initial sync mode so the scheduled sync handlers pick up a full resumable sync on their next run.',
  isHeadless: true,
  component: SyncResendData,
  command: {
    universalIdentifier: SYNC_RESEND_DATA_COMMAND_UNIVERSAL_IDENTIFIER,
    label: 'Sync Resend data',
    icon: 'IconRefresh',
    isPinned: false,
    availabilityType: 'GLOBAL',
  },
});
