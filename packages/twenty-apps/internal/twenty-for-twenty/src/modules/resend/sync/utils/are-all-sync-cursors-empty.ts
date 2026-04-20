import { CoreApiClient } from 'twenty-client-sdk/core';
import { isDefined } from '@utils/is-defined';

import { extractConnection } from '@modules/resend/shared/utils/typed-client';
import type { SyncCursorStep } from '@modules/resend/sync/cursor/types/sync-cursor-step';

const REQUIRED_STEPS: ReadonlyArray<SyncCursorStep> = [
  'SEGMENTS',
  'TEMPLATES',
  'CONTACTS',
  'EMAILS',
  'BROADCASTS',
];

type SyncCursorNode = {
  step: SyncCursorStep;
  cursor: string | null;
  lastRunStatus: 'SUCCESS' | 'FAILED' | 'IN_PROGRESS' | null;
};

export const areAllSyncCursorsEmpty = async (
  client: CoreApiClient,
): Promise<boolean> => {
  const queryResult = await client.query({
    resendSyncCursors: {
      __args: {
        first: REQUIRED_STEPS.length + 5,
      },
      edges: {
        node: {
          step: true,
          cursor: true,
          lastRunStatus: true,
        },
      },
    },
  });

  const connection = extractConnection<SyncCursorNode>(
    queryResult,
    'resendSyncCursors',
  );

  const rowByStep = new Map<SyncCursorStep, SyncCursorNode>();

  for (const edge of connection.edges) {
    if (isDefined(edge.node?.step)) {
      rowByStep.set(edge.node.step, edge.node);
    }
  }

  return REQUIRED_STEPS.every((step) => {
    const row = rowByStep.get(step);

    if (!isDefined(row)) return false;

    const cursorCleared = !isDefined(row.cursor) || row.cursor.length === 0;
    const succeeded = row.lastRunStatus === 'SUCCESS';

    return cursorCleared && succeeded;
  });
};
