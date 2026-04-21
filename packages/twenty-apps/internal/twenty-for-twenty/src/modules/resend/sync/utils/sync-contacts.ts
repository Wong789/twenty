import type { Resend } from 'resend';
import { CoreApiClient } from 'twenty-client-sdk/core';
import { isDefined } from '@utils/is-defined';

import type { ContactDto } from '@modules/resend/sync/types/contact.dto';
import type { SyncResult } from '@modules/resend/sync/types/sync-result';
import type { SyncStepResult } from '@modules/resend/sync/types/sync-step-result';
import { findPeopleByEmail } from '@modules/resend/shared/utils/find-people-by-email';
import { forEachPage } from '@modules/resend/shared/utils/for-each-page';
import { toEmailsField } from '@modules/resend/shared/utils/to-emails-field';
import { toIsoString } from '@modules/resend/shared/utils/to-iso-string';
import { upsertRecords } from '@modules/resend/sync/utils/upsert-records';
import { withSyncCursor } from '@modules/resend/sync/cursor/utils/with-sync-cursor';

type RawContact = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  unsubscribed: boolean;
  created_at: string;
};

const toContactDto = (
  contact: RawContact,
  syncedAt: string,
  personId: string | undefined,
): ContactDto => ({
  email: toEmailsField(contact.email),
  name: {
    firstName: contact.first_name ?? '',
    lastName: contact.last_name ?? '',
  },
  unsubscribed: contact.unsubscribed,
  createdAt: toIsoString(contact.created_at),
  lastSyncedFromResend: syncedAt,
  ...(isDefined(personId) && { personId }),
});

export const syncContacts = async (
  resend: Resend,
  client: CoreApiClient,
  syncedAt: string,
): Promise<SyncStepResult> => {
  const aggregate: SyncResult = {
    fetched: 0,
    created: 0,
    updated: 0,
    errors: [],
  };

  await withSyncCursor(client, 'CONTACTS', async ({ resumeCursor, onCursorAdvance }) => {
    await forEachPage(
      (paginationParameters) => resend.contacts.list(paginationParameters),
      async (pageContacts) => {
        const personIdByEmail = await findPeopleByEmail(
          client,
          pageContacts.map((contact) => contact.email),
        );

        const resolvePersonId = (email: string): string | undefined =>
          personIdByEmail.get(email.trim().toLowerCase());

        const pageOutcome = await upsertRecords({
          items: pageContacts,
          getId: (contact) => contact.id,
          mapCreateData: (_detail, item) =>
            toContactDto(item, syncedAt, resolvePersonId(item.email)),
          mapUpdateData: (_detail, item) =>
            toContactDto(item, syncedAt, resolvePersonId(item.email)),
          client,
          objectNameSingular: 'resendContact',
          objectNamePlural: 'resendContacts',
        });

        aggregate.fetched += pageOutcome.result.fetched;
        aggregate.created += pageOutcome.result.created;
        aggregate.updated += pageOutcome.result.updated;
        aggregate.errors.push(...pageOutcome.result.errors);

        return { ok: pageOutcome.ok, errors: pageOutcome.result.errors };
      },
      'contacts',
      { startCursor: resumeCursor, onCursorAdvance },
    );
  });

  return { result: aggregate, value: undefined };
};
