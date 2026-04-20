import { CoreApiClient } from 'twenty-client-sdk/core';
import { isDefined } from '@utils/is-defined';

import type {
  SyncCursorRow,
  SyncCursorStep,
} from 'src/modules/resend/sync/cursor/types/sync-cursor-step';
import {
  extractConnection,
  extractMutationRecord,
} from '@modules/resend/shared/utils/typed-client';

type SyncCursorNode = {
  id: string;
  step: SyncCursorStep;
  cursor: string | null;
};

const findExistingCursor = async (
  client: CoreApiClient,
  step: SyncCursorStep,
): Promise<SyncCursorRow | null> => {
  const queryResult = await client.query({
    resendSyncCursors: {
      __args: {
        filter: {
          step: { eq: step },
        },
        first: 1,
      },
      edges: {
        node: {
          id: true,
          step: true,
          cursor: true,
        },
      },
    },
  });

  const connection = extractConnection<SyncCursorNode>(
    queryResult,
    'resendSyncCursors',
  );

  const existingNode = connection.edges[0]?.node;

  if (!isDefined(existingNode)) {
    return null;
  }

  return {
    id: existingNode.id,
    step: existingNode.step,
    cursor: existingNode.cursor,
  };
};

export const getOrCreateSyncCursor = async (
  client: CoreApiClient,
  step: SyncCursorStep,
): Promise<SyncCursorRow> => {
  const existing = await findExistingCursor(client, step);

  if (isDefined(existing)) {
    return existing;
  }

  try {
    const createResult = await client.mutation({
      createResendSyncCursor: {
        __args: {
          data: {
            step,
          },
        },
        id: true,
      },
    });

    const created = extractMutationRecord<{ id: string }>(
      createResult,
      'createResendSyncCursor',
    );

    if (!isDefined(created)) {
      throw new Error(`Failed to create resendSyncCursor for step ${step}`);
    }

    return {
      id: created.id,
      step,
      cursor: null,
    };
  } catch (createError) {
    const raceWinner = await findExistingCursor(client, step);

    if (isDefined(raceWinner)) {
      return raceWinner;
    }

    throw createError;
  }
};
