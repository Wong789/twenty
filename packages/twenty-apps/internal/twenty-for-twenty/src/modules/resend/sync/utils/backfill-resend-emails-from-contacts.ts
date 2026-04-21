import { CoreApiClient } from 'twenty-client-sdk/core';
import { isDefined } from '@utils/is-defined';

import { TWENTY_PAGE_SIZE } from '@modules/resend/constants/sync-config';
import { getErrorMessage } from '@modules/resend/shared/utils/get-error-message';
import { extractConnection } from '@modules/resend/shared/utils/typed-client';

export type ContactBackfillEntry = {
  contactId: string;
  personId?: string;
};

type ExistingResendEmail = {
  id: string;
  contactId?: string | null;
  personId?: string | null;
  toAddresses?: { primaryEmail?: string | null } | null;
};

export type BackfillResendEmailsFromContactsResult = {
  updated: number;
  errors: string[];
};

const normalize = (email: string): string => email.trim().toLowerCase();

export const backfillResendEmailsFromContacts = async (
  client: CoreApiClient,
  entriesByEmail: ReadonlyMap<string, ContactBackfillEntry>,
): Promise<BackfillResendEmailsFromContactsResult> => {
  const result: BackfillResendEmailsFromContactsResult = {
    updated: 0,
    errors: [],
  };

  const emailKeys = Array.from(entriesByEmail.keys());

  if (emailKeys.length === 0) return result;

  let hasNextPage = true;
  let afterCursor: string | undefined;

  while (hasNextPage) {
    let pageEmails: ExistingResendEmail[];
    let endCursor: string | null | undefined;
    let pageHasNext: boolean;

    try {
      const queryArgs: Record<string, unknown> = {
        filter: {
          toAddresses: {
            primaryEmail: { in: emailKeys },
          },
        },
        first: TWENTY_PAGE_SIZE,
      };

      if (isDefined(afterCursor)) {
        queryArgs.after = afterCursor;
      }

      const queryResult = await client.query({
        resendEmails: {
          __args: queryArgs,
          pageInfo: {
            hasNextPage: true,
            endCursor: true,
          },
          edges: {
            node: {
              id: true,
              contactId: true,
              personId: true,
              toAddresses: { primaryEmail: true },
            },
          },
        },
      });

      const connection = extractConnection<ExistingResendEmail>(
        queryResult,
        'resendEmails',
      );

      pageEmails = connection.edges.map((edge) => edge.node);
      pageHasNext = connection.pageInfo?.hasNextPage ?? false;
      endCursor = connection.pageInfo?.endCursor;
    } catch (error) {
      result.errors.push(
        `backfillResendEmailsFromContacts lookup: ${getErrorMessage(error)}`,
      );

      return result;
    }

    for (const email of pageEmails) {
      const primaryRecipient = email.toAddresses?.primaryEmail;

      if (
        typeof primaryRecipient !== 'string' ||
        primaryRecipient.length === 0
      ) {
        continue;
      }

      const entry = entriesByEmail.get(normalize(primaryRecipient));

      if (!isDefined(entry)) continue;

      const data: Record<string, string> = {};

      if (!isDefined(email.contactId)) {
        data.contactId = entry.contactId;
      }

      if (!isDefined(email.personId) && isDefined(entry.personId)) {
        data.personId = entry.personId;
      }

      if (Object.keys(data).length === 0) continue;

      try {
        await client.mutation({
          updateResendEmail: {
            __args: {
              id: email.id,
              data,
            },
            id: true,
          },
        });

        result.updated++;
      } catch (error) {
        result.errors.push(
          `backfillResendEmailsFromContacts ${email.id}: ${getErrorMessage(error)}`,
        );
      }
    }

    hasNextPage = pageHasNext && isDefined(endCursor);
    afterCursor = endCursor ?? undefined;
  }

  return result;
};
