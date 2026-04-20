import { CoreApiClient } from 'twenty-client-sdk/core';
import { isDefined } from '@utils/is-defined';

import { getOrCreateSyncCursor } from 'src/modules/resend/sync/cursor/utils/get-or-create-sync-cursor';
import { setCursor } from 'src/modules/resend/sync/cursor/utils/set-cursor';
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

  const context: SyncCursorContext = {
    resumeCursor: isDefined(cursorRow.cursor) ? cursorRow.cursor : undefined,
    onCursorAdvance: (cursor) => setCursor(client, cursorRow.id, cursor),
  };

  const value = await runWithCursor(context);

  await setCursor(client, cursorRow.id, null);

  return value;
};
