import { isDefined } from '@utils/is-defined';
import { CoreApiClient } from 'twenty-client-sdk/core';
import { MetadataApiClient } from 'twenty-client-sdk/metadata';
import { defineFrontComponent } from 'twenty-sdk/define';
import {
  Command,
  enqueueSnackbar,
  updateProgress,
} from 'twenty-sdk/front-component';

import { APPLICATION_UNIVERSAL_IDENTIFIER } from '@constants/universal-identifiers';
import { INITIAL_SYNC_MODE_ENV_VAR_NAME } from '@modules/resend/constants/sync-config';
import {
  RESEND_INITIAL_LIST_SYNC_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
  SYNC_RESEND_DATA_COMMAND_UNIVERSAL_IDENTIFIER,
  SYNC_RESEND_DATA_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER,
} from '@modules/resend/constants/universal-identifiers';
import { extractConnection } from '@modules/resend/shared/utils/typed-client';

type InitialListSyncSummaryStep = {
  name: string;
  status: 'ok' | 'failed' | 'skipped';
  fetched: number;
  created: number;
  updated: number;
  errorCount: number;
  durationMs: number;
};

type InitialListSyncSummary = {
  skipped: boolean;
  initialSyncCompleted: boolean;
  totalDurationMs: number;
  steps: InitialListSyncSummaryStep[];
};

type CursorRowId = { id: string };

const formatStepCounts = (step: InitialListSyncSummaryStep): string => {
  const verbs: string[] = [];

  if (step.created > 0) verbs.push(`${step.created} created`);
  if (step.updated > 0) verbs.push(`${step.updated} updated`);

  const counts =
    verbs.length > 0 ? verbs.join(', ') : `${step.fetched} fetched`;

  return `${step.name.toLowerCase()}: ${counts}`;
};

const formatSummary = (summary: InitialListSyncSummary): string => {
  const seconds = (summary.totalDurationMs / 1000).toFixed(1);
  const stepLines = summary.steps
    .filter((step) => step.status === 'ok')
    .map(formatStepCounts);

  const prefix = summary.initialSyncCompleted
    ? `Initial sync completed in ${seconds}s`
    : `Initial list pass ran in ${seconds}s (still in initial sync mode)`;

  if (stepLines.length === 0) {
    return prefix;
  }

  return `${prefix} — ${stepLines.join('; ')}`;
};

const isInitialListSyncSummary = (
  value: unknown,
): value is InitialListSyncSummary =>
  typeof value === 'object' &&
  value !== null &&
  Array.isArray((value as InitialListSyncSummary).steps) &&
  typeof (value as InitialListSyncSummary).totalDurationMs === 'number';

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

const resetSyncCursors = async (client: CoreApiClient): Promise<void> => {
  const result = await client.query({
    resendSyncCursors: {
      __args: { first: 50 },
      edges: {
        node: {
          id: true,
        },
      },
    },
  });

  const connection = extractConnection<CursorRowId>(
    result,
    'resendSyncCursors',
  );

  for (const edge of connection.edges) {
    if (!isDefined(edge.node?.id)) continue;

    await client.mutation({
      updateResendSyncCursor: {
        __args: {
          id: edge.node.id,
          data: { cursor: null },
        },
        id: true,
      },
    });
  }
};

const execute = async () => {
  await updateProgress(0.05);

  const metadataClient = new MetadataApiClient();
  const coreApiClient = new CoreApiClient();

  const applicationId = await resolveApplicationId(metadataClient);

  await updateProgress(0.15);

  await flipInitialSyncModeOn(metadataClient, applicationId);

  await updateProgress(0.25);

  await resetSyncCursors(coreApiClient);

  await updateProgress(0.35);

  const { findManyLogicFunctions } = await metadataClient.query({
    findManyLogicFunctions: {
      id: true,
      universalIdentifier: true,
    },
  });

  const syncFunction = findManyLogicFunctions.find(
    (logicFunction) =>
      logicFunction.universalIdentifier ===
      RESEND_INITIAL_LIST_SYNC_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
  );

  if (!isDefined(syncFunction)) {
    throw new Error('Resend initial list sync logic function not found');
  }

  await updateProgress(0.45);

  const { executeOneLogicFunction } = await metadataClient.mutation({
    executeOneLogicFunction: {
      __args: {
        input: {
          id: syncFunction.id,
          payload: {} as Record<string, unknown>,
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
        : 'Initial list sync execution failed';

    throw new Error(`Resend initial sync failed:\n${rawMessage}`);
  }

  await updateProgress(1);

  const summaryMessage = isInitialListSyncSummary(executeOneLogicFunction.data)
    ? formatSummary(executeOneLogicFunction.data)
    : 'Resend initial sync triggered';

  await enqueueSnackbar({
    message: summaryMessage,
    variant: 'success',
  });
};

const SyncResendData = () => <Command execute={execute} />;

export default defineFrontComponent({
  universalIdentifier: SYNC_RESEND_DATA_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER,
  name: 'Sync Resend Data',
  description:
    'Enters initial sync mode, resets sync cursors, and triggers the first list-only pass',
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
