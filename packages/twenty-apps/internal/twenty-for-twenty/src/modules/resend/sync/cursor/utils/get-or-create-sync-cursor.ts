import { CoreApiClient } from 'twenty-client-sdk/core';
import { isDefined } from '@utils/is-defined';

import type {
  SyncCursorRow,
  SyncCursorStep,
} from 'src/modules/resend/sync/cursor/types/sync-cursor-step';

type ConnectionResult = {
  edges: Array<{
    node: {
      id: string;
      step: SyncCursorStep;
      cursor: string | null;
    };
  }>;
};

export const getOrCreateSyncCursor = async (
  client: CoreApiClient,
  step: SyncCursorStep,
): Promise<SyncCursorRow> => {
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

  const connection = (queryResult as Record<string, unknown>)
    .resendSyncCursors as ConnectionResult | undefined;

  const existingNode = connection?.edges[0]?.node;

  if (isDefined(existingNode)) {
    return {
      id: existingNode.id,
      step: existingNode.step,
      cursor: existingNode.cursor,
    };
  }

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

  const created = (createResult as Record<string, unknown>)
    .createResendSyncCursor as { id: string } | undefined;

  if (!isDefined(created)) {
    throw new Error(`Failed to create resendSyncCursor for step ${step}`);
  }

  return {
    id: created.id,
    step,
    cursor: null,
  };
};
