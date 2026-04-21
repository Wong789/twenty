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
  RESEND_SYNC_BROADCASTS_AND_DEPENDENCIES_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
  RESEND_SYNC_CONTACTS_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
  RESEND_SYNC_EMAILS_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
  RESEND_SYNC_TEMPLATES_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
  SYNC_RESEND_DATA_COMMAND_UNIVERSAL_IDENTIFIER,
  SYNC_RESEND_DATA_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER,
} from '@modules/resend/constants/universal-identifiers';
import { extractConnection } from '@modules/resend/shared/utils/typed-client';

type SyncSummaryStep = {
  name: string;
  status: 'ok' | 'failed' | 'skipped';
  fetched: number;
  created: number;
  updated: number;
  errorCount: number;
  durationMs: number;
};

type SyncFunctionSummary = {
  totalDurationMs: number;
  steps: SyncSummaryStep[];
};

type CursorRowId = { id: string };

type LogicFunctionDescriptor = {
  universalIdentifier: string;
  label: string;
};

const SYNC_FUNCTION_DESCRIPTORS: ReadonlyArray<LogicFunctionDescriptor> = [
  {
    universalIdentifier:
      RESEND_SYNC_BROADCASTS_AND_DEPENDENCIES_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
    label: 'topics + segments + broadcasts',
  },
  {
    universalIdentifier:
      RESEND_SYNC_TEMPLATES_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
    label: 'templates',
  },
  {
    universalIdentifier:
      RESEND_SYNC_CONTACTS_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
    label: 'contacts',
  },
  {
    universalIdentifier:
      RESEND_SYNC_EMAILS_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
    label: 'emails',
  },
];

const formatStepCounts = (step: SyncSummaryStep): string => {
  const verbs: string[] = [];

  if (step.created > 0) verbs.push(`${step.created} created`);
  if (step.updated > 0) verbs.push(`${step.updated} updated`);

  const counts =
    verbs.length > 0 ? verbs.join(', ') : `${step.fetched} fetched`;

  return `${step.name.toLowerCase()}: ${counts}`;
};

const formatAggregatedSummary = (
  summaries: ReadonlyArray<SyncFunctionSummary>,
): string => {
  const allSteps = summaries.flatMap((summary) => summary.steps);
  const totalDurationMs = summaries.reduce(
    (acc, summary) => acc + summary.totalDurationMs,
    0,
  );
  const seconds = (totalDurationMs / 1000).toFixed(1);
  const stepLines = allSteps
    .filter((step) => step.status === 'ok')
    .map(formatStepCounts);

  const prefix = `Initial sync triggered (${seconds}s)`;

  if (stepLines.length === 0) {
    return prefix;
  }

  return `${prefix} — ${stepLines.join('; ')}`;
};

const isSyncFunctionSummary = (
  value: unknown,
): value is SyncFunctionSummary =>
  typeof value === 'object' &&
  value !== null &&
  Array.isArray((value as SyncFunctionSummary).steps) &&
  typeof (value as SyncFunctionSummary).totalDurationMs === 'number';

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

const executeSyncFunction = async (
  metadataClient: MetadataApiClient,
  logicFunctionId: string,
  label: string,
): Promise<SyncFunctionSummary> => {
  const { executeOneLogicFunction } = await metadataClient.mutation({
    executeOneLogicFunction: {
      __args: {
        input: {
          id: logicFunctionId,
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
        : `${label} sync execution failed`;

    throw new Error(`Resend ${label} sync failed:\n${rawMessage}`);
  }

  if (isSyncFunctionSummary(executeOneLogicFunction.data)) {
    return executeOneLogicFunction.data;
  }

  return { totalDurationMs: 0, steps: [] };
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

  const idByUniversalIdentifier = new Map<string, string>();

  for (const logicFunction of findManyLogicFunctions) {
    if (
      typeof logicFunction.universalIdentifier === 'string' &&
      typeof logicFunction.id === 'string'
    ) {
      idByUniversalIdentifier.set(
        logicFunction.universalIdentifier,
        logicFunction.id,
      );
    }
  }

  const resolvedFunctions = SYNC_FUNCTION_DESCRIPTORS.map((descriptor) => {
    const id = idByUniversalIdentifier.get(descriptor.universalIdentifier);

    if (!isDefined(id)) {
      throw new Error(
        `Resend sync logic function ${descriptor.label} not found`,
      );
    }

    return { id, label: descriptor.label };
  });

  await updateProgress(0.45);

  const summaries = await Promise.all(
    resolvedFunctions.map(({ id, label }) =>
      executeSyncFunction(metadataClient, id, label),
    ),
  );

  await updateProgress(1);

  await enqueueSnackbar({
    message: formatAggregatedSummary(summaries),
    variant: 'success',
  });
};

const SyncResendData = () => <Command execute={execute} />;

export default defineFrontComponent({
  universalIdentifier: SYNC_RESEND_DATA_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER,
  name: 'Sync Resend Data',
  description:
    'Enters initial sync mode, resets sync cursors, and triggers all per-entity sync functions in parallel.',
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
