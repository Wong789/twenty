import { CoreApiClient } from 'twenty-client-sdk/core';
import { isDefined } from '@utils/is-defined';

import { getOrCreateSyncCursor } from 'src/modules/resend/sync/cursor/utils/get-or-create-sync-cursor';
import {
  setCursor,
  updateCursorRow,
} from 'src/modules/resend/sync/cursor/utils/set-cursor';
import type { SyncCursorStep } from 'src/modules/resend/sync/cursor/types/sync-cursor-step';

export type SyncCursorContext = {
  resumeCursor: string | undefined;
  onCursorAdvance: (cursor: string) => Promise<void>;
};

export const withSyncCursor = async <TValue>(
  client: CoreApiClient,
  step: SyncCursorStep,
  runWithCursor: (context: SyncCursorContext) => Promise<TValue>,
): Promise<TValue> => {
  const cursorRow = await getOrCreateSyncCursor(client, step);
  const startedAt = new Date().toISOString();

  await updateCursorRow(client, cursorRow.id, {
    lastRunAt: startedAt,
    lastRunStatus: 'IN_PROGRESS',
  });

  const context: SyncCursorContext = {
    resumeCursor:
      isDefined(cursorRow.cursor) && cursorRow.cursor.length > 0
        ? cursorRow.cursor
        : undefined,
    onCursorAdvance: (cursor) => setCursor(client, cursorRow.id, cursor),
  };

  try {
    const value = await runWithCursor(context);

    await updateCursorRow(client, cursorRow.id, {
      cursor: null,
      lastRunStatus: 'SUCCESS',
    });

    return value;
  } catch (runError) {
    await updateCursorRow(client, cursorRow.id, {
      lastRunStatus: 'FAILED',
    });

    throw runError;
  }
};
