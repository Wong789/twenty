import { MetadataApiClient } from 'twenty-client-sdk/metadata';
import { defineFrontComponent } from 'twenty-sdk/define';
import { Command, enqueueSnackbar, updateProgress } from 'twenty-sdk/front-component';
import { isDefined } from '@utils/is-defined';

import {
  SYNC_RESEND_DATA_COMMAND_UNIVERSAL_IDENTIFIER,
  SYNC_RESEND_DATA_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER,
  SYNC_RESEND_DATA_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
} from '@modules/resend/constants/universal-identifiers';

const SYNC_STEPS = [
  'SEGMENTS',
  'TEMPLATES',
  'CONTACTS',
  'EMAILS',
  'BROADCASTS',
] as const;

const LOOKUP_PROGRESS = 0.1;

const execute = async () => {
  await updateProgress(0.05);

  const metadataClient = new MetadataApiClient();

  const { findManyLogicFunctions } = await metadataClient.query({
    findManyLogicFunctions: {
      id: true,
      universalIdentifier: true,
    },
  });

  const syncFunction = findManyLogicFunctions.find(
    (logicFunction) =>
      logicFunction.universalIdentifier ===
      SYNC_RESEND_DATA_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
  );

  if (!isDefined(syncFunction)) {
    throw new Error('Sync logic function not found');
  }

  await updateProgress(LOOKUP_PROGRESS);

  for (let stepIndex = 0; stepIndex < SYNC_STEPS.length; stepIndex++) {
    const step = SYNC_STEPS[stepIndex];

    const { executeOneLogicFunction } = await metadataClient.mutation({
      executeOneLogicFunction: {
        __args: {
          input: {
            id: syncFunction.id,
            payload: { step } as Record<string, unknown>,
          },
        },
        status: true,
        error: true,
      },
    });

    if (executeOneLogicFunction.status !== 'SUCCESS') {
      const rawMessage =
        typeof executeOneLogicFunction.error?.errorMessage === 'string'
          ? executeOneLogicFunction.error.errorMessage
          : `Sync logic function execution failed for step "${step}"`;

      const isRateLimit =
        rawMessage.toLowerCase().includes('rate_limit') ||
        rawMessage.toLowerCase().includes('rate limit');

      throw new Error(
        isRateLimit
          ? `Sync failed at step "${step}": Resend API rate limit exceeded. Please try again later.`
          : `Sync failed at step "${step}": ${rawMessage}`,
      );
    }

    const progress =
      LOOKUP_PROGRESS +
      ((stepIndex + 1) / SYNC_STEPS.length) * (1 - LOOKUP_PROGRESS);

    await updateProgress(progress);
  }

  await enqueueSnackbar({
    message: 'Resend data sync completed',
    variant: 'success',
  });
};

const SyncResendData = () => <Command execute={execute} />;

export default defineFrontComponent({
  universalIdentifier: SYNC_RESEND_DATA_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER,
  name: 'Sync Resend Data',
  description: 'Triggers a manual sync of all Resend data',
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
