import { isDefined } from '@utils/is-defined';
import { MetadataApiClient } from 'twenty-client-sdk/metadata';
import { defineFrontComponent } from 'twenty-sdk/define';
import {
  Command,
  enqueueSnackbar,
  updateProgress,
} from 'twenty-sdk/front-component';

import { SYNC_LOOKUP_PROGRESS } from '@modules/resend/constants/sync-config';
import {
  SYNC_RESEND_DATA_COMMAND_UNIVERSAL_IDENTIFIER,
  SYNC_RESEND_DATA_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER,
  SYNC_RESEND_DATA_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
} from '@modules/resend/constants/universal-identifiers';

type SyncSummaryStep = {
  name: string;
  status: 'ok' | 'failed' | 'skipped';
  fetched: number;
  created: number;
  updated: number;
  errorCount: number;
  durationMs: number;
};

type SyncSummary = {
  totalDurationMs: number;
  steps: SyncSummaryStep[];
};

const formatStepCounts = (step: SyncSummaryStep): string => {
  const verbs: string[] = [];

  if (step.created > 0) verbs.push(`${step.created} created`);
  if (step.updated > 0) verbs.push(`${step.updated} updated`);

  const counts =
    verbs.length > 0 ? verbs.join(', ') : `${step.fetched} fetched`;

  return `${step.name.toLowerCase()}: ${counts}`;
};

const formatSummary = (summary: SyncSummary): string => {
  const seconds = (summary.totalDurationMs / 1000).toFixed(1);
  const stepLines = summary.steps
    .filter((step) => step.status === 'ok')
    .map(formatStepCounts);

  if (stepLines.length === 0) {
    return `Resend sync completed in ${seconds}s`;
  }

  return `Resend sync completed in ${seconds}s — ${stepLines.join('; ')}`;
};

const isSyncSummary = (value: unknown): value is SyncSummary =>
  typeof value === 'object' &&
  value !== null &&
  Array.isArray((value as SyncSummary).steps) &&
  typeof (value as SyncSummary).totalDurationMs === 'number';

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

  await updateProgress(SYNC_LOOKUP_PROGRESS);

  const { executeOneLogicFunction } = await metadataClient.mutation({
    executeOneLogicFunction: {
      __args: {
        input: {
          id: syncFunction.id,
          payload: { step: 'ALL' } as Record<string, unknown>,
        },
      },
      status: true,
      error: true,
      data: true,
    },
  });

  if (executeOneLogicFunction.status !== 'SUCCESS') {
    const rawMessage =
      typeof executeOneLogicFunction.error?.errorMessage === 'string'
        ? executeOneLogicFunction.error.errorMessage
        : 'Sync logic function execution failed';

    throw new Error(`Resend sync failed:\n${rawMessage}`);
  }

  await updateProgress(1);

  const summaryMessage = isSyncSummary(executeOneLogicFunction.data)
    ? formatSummary(executeOneLogicFunction.data)
    : 'Resend data sync completed';

  await enqueueSnackbar({
    message: summaryMessage,
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
